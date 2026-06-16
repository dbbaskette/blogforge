"""Voice-aware pack-root resolution.

``resolve_voice`` is the single function routes call to get the pack
directory they should build prompts from.  It centralises the choice
between the user's materialised voice profile and a traditional style pack.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


async def resolve_voice(
    draft: Any,
    user_id: Any,
    *,
    pack_store: Any,
    voice_store: Any = None,
) -> Path:
    """Return the pack root directory to use for generation.

    Args:
        draft: A Draft (or draft-like object) with an ``idea`` attribute that
            has ``use_voice_profile`` (bool) and ``pack_slug`` (str).
        user_id: The authenticated user's id (UUID or str).
        pack_store: The application's pack store (``request.app.state.pack_store``).
        voice_store: Optional pre-constructed ``SqlVoiceStore``; created lazily
            when ``use_voice_profile`` is True and none is supplied.

    Returns:
        The ``Path`` to the pack root directory (a directory that contains
        ``stylepack.yaml``).

    Note:
        When ``use_voice_profile`` is False this function does NOT raise if the
        pack is missing — it returns the root_path from the store, which may be
        None.  Callers should retain the existing pack-missing 404 guard for the
        non-profile branch (pass the pack lookup result before calling this) or
        call ``pack_store.get`` themselves and only fall through to this function
        when the pack exists.  In practice the routes call this function and
        then read ``stylepack.yaml`` from the returned path; a missing pack
        raises at that point, but we preserve the explicit 404 guard in routes.
    """
    if draft.idea.use_voice_profile:
        from blogforge.s3 import S3Error, get_s3_client
        from blogforge.voice.pack import materialize
        from blogforge.voice.store import SqlVoiceStore

        store = voice_store or SqlVoiceStore()
        profile = await store.get_or_create(user_id)

        # Fetch text for each exemplar sample from S3; skip any that fail.
        sample_texts: dict[str, str] = {}
        s3 = get_s3_client()
        for sample in profile.samples:
            if not sample.exemplar or not sample.s3_key:
                continue
            try:
                raw = await s3.get_object(sample.s3_key)
                sample_texts[sample.id] = raw.decode("utf-8", errors="replace")
            except (S3Error, Exception) as exc:
                logger.warning(
                    "resolve_voice: skipping sample %s (s3_key=%r): %s",
                    sample.id,
                    sample.s3_key,
                    exc,
                )

        return await materialize(profile, sample_texts)
    else:
        pack_info = pack_store.get(draft.idea.pack_slug)
        # Callers keep their existing 404 guard; we just return the path.
        # If pack_info is None the caller's guard already raised before here
        # (or will raise when they try to read stylepack.yaml).
        return pack_info.root_path
