"""Voice profile REST API.

All endpoints are scoped to the authenticated user (current.id).

Routes:
  GET  /api/voice                           → VoiceProfile
  PUT  /api/voice/persona                   → VoiceProfile
  PUT  /api/voice/rules                     → VoiceProfile
  PUT  /api/voice/distilled                 → VoiceProfile
  POST /api/voice/samples/text              → VoiceSample
  POST /api/voice/samples/url               → VoiceSample
  POST /api/voice/samples/file              → VoiceSample (multipart)
  DELETE /api/voice/samples/{sample_id}     → 204
  PUT  /api/voice/samples/{sample_id}/exemplar → VoiceProfile
  POST /api/voice/distill                   → VoiceProfile (runs LLM distillation)
  GET  /api/voice/export                    → ZIP download
  POST /api/voice/sources                   → VoiceSource
  GET  /api/voice/sources                   → list[VoiceSource]
  DELETE /api/voice/sources/{source_id}     → 204
"""
from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, Field

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.voice.ingest import add_file_sample, add_text_sample, add_url_sample, add_url_source
from blogforge.voice.models import VoiceProfile, VoiceRules, VoiceSample, VoiceSource
from blogforge.voice.guide import build_voice_guide
from blogforge.voice.pack import export_zip, materialize
from blogforge.voice.store import SqlVoiceStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])

# ---------------------------------------------------------------------------
# Request body shapes
# ---------------------------------------------------------------------------


class _PersonaBody(BaseModel):
    identity: str = ""
    one_line: str = ""
    tone: str = ""


class _DistilledBody(BaseModel):
    distilled_style_md: str


class _TextSampleBody(BaseModel):
    name: str
    text: str


class _UrlSampleBody(BaseModel):
    url: str


class _ExemplarBody(BaseModel):
    exemplar: bool


class _UrlSourceBody(BaseModel):
    url: str


class _DistillBody(BaseModel):
    provider: str | None = None
    model: str | None = None


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _store(request: Request) -> SqlVoiceStore:
    store: SqlVoiceStore = request.app.state.voice_store
    return store


# ---------------------------------------------------------------------------
# GET /api/voice
# ---------------------------------------------------------------------------


@router.get("")
async def get_profile(
    request: Request,
    current: User = Depends(get_current_user),
) -> VoiceProfile:
    """Return (or create) the current user's voice profile."""
    return await _store(request).get_or_create(current.id)


# ---------------------------------------------------------------------------
# PUT /api/voice/persona
# ---------------------------------------------------------------------------


@router.put("/persona")
async def update_persona(
    body: _PersonaBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> VoiceProfile:
    return await _store(request).update_persona(
        current.id,
        identity=body.identity,
        one_line=body.one_line,
        tone=body.tone,
    )


# ---------------------------------------------------------------------------
# PUT /api/voice/rules
# ---------------------------------------------------------------------------


@router.put("/rules")
async def update_rules(
    body: VoiceRules,
    request: Request,
    current: User = Depends(get_current_user),
) -> VoiceProfile:
    return await _store(request).update_rules(current.id, body)


# ---------------------------------------------------------------------------
# PUT /api/voice/distilled
# ---------------------------------------------------------------------------


@router.put("/distilled")
async def update_distilled(
    body: _DistilledBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> VoiceProfile:
    return await _store(request).set_distilled(current.id, body.distilled_style_md)


# ---------------------------------------------------------------------------
# POST /api/voice/samples/text
# ---------------------------------------------------------------------------


@router.post("/samples/text", status_code=status.HTTP_201_CREATED)
async def add_text(
    body: _TextSampleBody,
    current: User = Depends(get_current_user),
) -> VoiceSample:
    return await add_text_sample(current.id, name=body.name, text=body.text)


# ---------------------------------------------------------------------------
# POST /api/voice/samples/url
# ---------------------------------------------------------------------------


@router.post("/samples/url", status_code=status.HTTP_201_CREATED)
async def add_url(
    body: _UrlSampleBody,
    current: User = Depends(get_current_user),
) -> VoiceSample:
    return await add_url_sample(current.id, url=body.url)


# ---------------------------------------------------------------------------
# POST /api/voice/samples/file
# ---------------------------------------------------------------------------


@router.post("/samples/file", status_code=status.HTTP_201_CREATED)
async def add_file(
    current: User = Depends(get_current_user),
    file: UploadFile = File(...),
) -> VoiceSample:
    filename = file.filename or "upload"
    data = await file.read()
    return await add_file_sample(current.id, filename=filename, data=data)


# ---------------------------------------------------------------------------
# DELETE /api/voice/samples/{sample_id}
# ---------------------------------------------------------------------------


@router.delete("/samples/{sample_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sample(
    sample_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Response:
    await _store(request).delete_sample(current.id, sample_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# PUT /api/voice/samples/{sample_id}/exemplar
# ---------------------------------------------------------------------------


@router.put("/samples/{sample_id}/exemplar")
async def set_exemplar(
    sample_id: str,
    body: _ExemplarBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> VoiceProfile:
    return await _store(request).set_exemplar(current.id, sample_id, body.exemplar)


# ---------------------------------------------------------------------------
# POST /api/voice/sources
# ---------------------------------------------------------------------------


@router.post("/sources", status_code=status.HTTP_201_CREATED)
async def add_source(
    body: _UrlSourceBody,
    current: User = Depends(get_current_user),
) -> VoiceSource:
    """Ingest a URL as a background/context source on the user's voice profile."""
    return await add_url_source(current.id, url=body.url)


# ---------------------------------------------------------------------------
# GET /api/voice/sources
# ---------------------------------------------------------------------------


@router.get("/sources")
async def list_sources(
    request: Request,
    current: User = Depends(get_current_user),
) -> list[VoiceSource]:
    """List all background sources on the user's voice profile."""
    return await _store(request).list_sources(current.id)


# ---------------------------------------------------------------------------
# DELETE /api/voice/sources/{source_id}
# ---------------------------------------------------------------------------


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(
    source_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Response:
    await _store(request).delete_source(current.id, source_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# POST /api/voice/distill
# ---------------------------------------------------------------------------

_PROVIDER_DEFAULTS: dict[str, str] = {
    "anthropic": "claude-sonnet-4-6",
    "openai": "gpt-5",
    "google": "gemini-2.5-flash",
    "claude-cli": "sonnet",
}


def _default_model(provider_name: str) -> str:
    """Default chat model for a provider when the caller didn't pick one.

    `tanzu` has no static default — the served models come from the binding —
    so fall back to the first configured Tanzu model (NOT the anthropic
    default, which the GenAI gateway doesn't serve and would 404 on)."""
    if provider_name == "tanzu":
        from blogforge.config import get_settings
        models = get_settings().tanzu_models
        return models[0] if models else "openai/gpt-oss-120b"
    return _PROVIDER_DEFAULTS.get(provider_name, "claude-sonnet-4-6")


async def _auto_select_provider(user_id) -> str | None:
    from blogforge.config import get_settings
    from blogforge.keys import KeyVault
    from blogforge.llm.claude_cli import claude_available

    # Prefer the local Claude CLI (keyless Max-subscription auth) as the default
    # writing engine when it's installed — the subscription over pay-per-token
    # API keys. This only sets the auto-selected default; an explicitly chosen
    # provider still wins upstream. Hero *image* generation is unaffected (it is
    # hardcoded to the Google key in api/hero.py).
    if claude_available():
        return "claude-cli"
    vault = KeyVault(user_id)
    for candidate in ("anthropic", "openai", "google"):
        if await vault.get(candidate):
            return candidate
    s = get_settings()
    if s.tanzu_api_base and s.tanzu_api_key:
        return "tanzu"
    return None


@router.post("/distill")
async def distill(
    body: _DistillBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> VoiceProfile:
    """Run LLM-based style distillation over the user's samples and store the result."""
    from blogforge.llm.resolve import build_provider_for
    from blogforge.s3 import get_s3_client
    from blogforge.voice.distill import distill_style

    store = _store(request)
    profile = await store.get_or_create(current.id)

    # --- resolve provider ---
    provider_name = body.provider or await _auto_select_provider(current.id)
    if provider_name is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "provider_missing_key",
                    "message": "No API key configured for any provider.",
                    "hint": "Add your key in Settings → Provider API keys.",
                }
            },
        )

    model = body.model or _default_model(provider_name)
    provider = await build_provider_for(current.id, provider_name)

    # --- load sample texts from S3 ---
    s3 = get_s3_client()
    texts: list[str] = []
    for sample in profile.samples:
        if not sample.s3_key:
            continue
        try:
            raw = await s3.get_object(sample.s3_key)
            texts.append(raw.decode("utf-8", errors="replace"))
        except Exception as exc:
            logger.warning("distill: skipping sample %s (%r): %s", sample.id, sample.s3_key, exc)

    # --- distill ---
    result = await distill_style(texts, provider, model=model)
    return await store.set_distilled(current.id, result)


# ---------------------------------------------------------------------------
# POST /api/voice/import/linkedin
# ---------------------------------------------------------------------------


@router.post("/import/linkedin")
async def import_linkedin(
    request: Request,
    file: UploadFile = File(...),
    provider: str | None = Form(None),
    model: str | None = Form(None),
    current: User = Depends(get_current_user),
) -> VoiceProfile:
    """Parse an uploaded LinkedIn data-export archive → prefill persona + seed samples."""
    from blogforge.llm.resolve import build_provider_for
    from blogforge.voice.ingest import add_text_sample
    from blogforge.voice.linkedin_import import (
        LinkedInImportError, PERSONA_SCHEMA, build_persona_prompt, parse_linkedin_archive, parse_persona,
    )

    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, detail={"error": {"code": "file_too_large", "message": "Archive exceeds 10 MB."}})
    try:
        parsed = parse_linkedin_archive(data)
    except LinkedInImportError as exc:
        raise HTTPException(400, detail={"error": {"code": "linkedin_parse_failed", "message": str(exc)}}) from exc

    store = _store(request)
    provider_name = provider or await _auto_select_provider(current.id)
    identity, one_line, tone = "", parsed.headline, ""
    if provider_name:
        prov = await build_provider_for(current.id, provider_name)
        mdl = model or _default_model(provider_name)
        try:
            resp = await prov.complete(
                model=mdl, prompt=build_persona_prompt(parsed.headline, parsed.summary), json_schema=PERSONA_SCHEMA
            )
            identity, one_line, tone = parse_persona(resp.text)
        except Exception:
            identity = parsed.summary.split(". ")[0][:200]
    elif parsed.summary:
        identity = parsed.summary.split(". ")[0][:200]

    await store.update_persona(current.id, identity=identity, one_line=one_line or parsed.headline, tone=tone)
    if parsed.summary:
        await add_text_sample(current.id, name="LinkedIn — About", text=parsed.summary)
    for art in parsed.articles[:25]:
        await add_text_sample(current.id, name=f"LinkedIn — {art.title}"[:120], text=art.text)
    return await store.get_or_create(current.id)


# ---------------------------------------------------------------------------
# GET /api/voice/export
# ---------------------------------------------------------------------------


@router.get("/export")
async def export_pack(
    request: Request,
    current: User = Depends(get_current_user),
) -> Response:
    """Download the user's voice pack as a ZIP archive."""
    from blogforge.s3 import get_s3_client

    store = _store(request)
    profile = await store.get_or_create(current.id)

    # Fetch text for each exemplar sample from S3; skip failures.
    s3 = get_s3_client()
    sample_texts: dict[str, str] = {}
    for sample in profile.samples:
        if not sample.exemplar or not sample.s3_key:
            continue
        try:
            raw = await s3.get_object(sample.s3_key)
            sample_texts[sample.id] = raw.decode("utf-8", errors="replace")
        except Exception as exc:
            logger.warning("export: skipping sample %s (%r): %s", sample.id, sample.s3_key, exc)

    pack_dir = await materialize(profile, sample_texts)
    zip_bytes = export_zip(pack_dir)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="voice-pack.zip"'},
    )


# ---------------------------------------------------------------------------
# GET /api/voice/guide.md
# ---------------------------------------------------------------------------


@router.get("/guide.md")
async def export_guide(
    request: Request,
    current: User = Depends(get_current_user),
) -> Response:
    """Download the user's voice as a portable Markdown guide."""
    store = _store(request)
    profile = await store.get_or_create(current.id)
    md = build_voice_guide(profile)
    slug = re.sub(r"[^a-z0-9]+", "-", (profile.name or "voice").lower()).strip("-") or "voice"
    return Response(
        content=md,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}-voice-guide.md"'},
    )


# ---------------------------------------------------------------------------
# POST /api/voice/audition — rewrite arbitrary text in the user's voice
# ---------------------------------------------------------------------------


class _AuditionBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.post("/audition")
async def audition_voice(
    body: _AuditionBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> dict:
    """Rewrite a snippet of text in the user's voice — an instant 'try my voice' demo."""
    import yaml

    from blogforge.llm.resolve import build_provider_for
    from blogforge.s3 import get_s3_client
    from blogforge.voice import compose_prompt
    from blogforge.voice.enforce import enforce_voice_rules
    from blogforge.voice.packs.manifest import Manifest

    store = _store(request)
    profile = await store.get_or_create(current.id)
    provider_name = await _auto_select_provider(current.id)
    if provider_name is None:
        raise HTTPException(
            400,
            detail={"error": {"code": "provider_missing_key",
                              "message": "No writing model is available.",
                              "hint": "Add a provider key in Settings, or use the Tanzu model."}},
        )
    prov = await build_provider_for(current.id, provider_name)
    mdl = _default_model(provider_name)

    s3 = get_s3_client()
    sample_texts: dict[str, str] = {}
    for s in profile.samples:
        if s.exemplar and s.s3_key:
            try:
                sample_texts[s.id] = (await s3.get_object(s.s3_key)).decode("utf-8", "replace")
            except Exception:  # noqa: BLE001 — skip unreadable samples
                pass
    pack_root = await materialize(profile, sample_texts)
    system = compose_prompt(pack_root)
    prompt = (
        f"{system}\n\nRewrite the text below so it reads in the author's voice described "
        "above. Preserve the meaning and facts exactly; do not add or drop ideas. Return "
        "ONLY the rewritten text.\n\nTEXT:\n" + body.text
    )
    resp = await prov.complete(model=mdl, prompt=prompt)
    out = (resp.text or "").strip() or body.text
    manifest = Manifest.model_validate(
        yaml.safe_load((pack_root / "stylepack.yaml").read_text(encoding="utf-8")) or {}
    )
    out = await enforce_voice_rules(out, manifest, prov, mdl)
    return {"original": body.text, "rewritten": out}


# ---------------------------------------------------------------------------
# GET /api/voice/fingerprint — stylometric "voiceprint" for the card
# ---------------------------------------------------------------------------

_DIMENSIONS = ("casual", "vivid", "punchy", "warm", "concrete", "direct")
_DIM_SCHEMA = {
    "type": "object",
    "properties": {k: {"type": "integer", "minimum": 0, "maximum": 100} for k in _DIMENSIONS},
    "required": list(_DIMENSIONS),
    "additionalProperties": False,
}


@router.get("/fingerprint")
async def voice_fingerprint(
    request: Request,
    current: User = Depends(get_current_user),
) -> dict:
    """A shareable 'voiceprint': tonal dimensions (LLM-scored) + deterministic
    rhythm / signature phrases / vocabulary from the user's samples."""
    from blogforge.s3 import get_s3_client
    from blogforge.voice.fingerprint import compute_stats

    store = _store(request)
    profile = await store.get_or_create(current.id)

    s3 = get_s3_client()
    texts: list[str] = []
    for s in profile.samples:
        if s.s3_key:
            try:
                texts.append((await s3.get_object(s.s3_key)).decode("utf-8", "replace"))
            except Exception:  # noqa: BLE001
                pass
    stats = compute_stats(texts)
    n_samples = sum(1 for t in texts if t.strip())
    n_exemplar = sum(1 for s in profile.samples if s.exemplar)
    strength = min(
        100,
        n_samples * 12 + n_exemplar * 6 + (40 if profile.distilled_style_md.strip() else 0),
    )

    dimensions: dict | None = None
    provider_name = await _auto_select_provider(current.id)
    if provider_name and stats["word_count"] >= 60:
        try:
            import json

            from blogforge.llm.resolve import build_provider_for
            prov = await build_provider_for(current.id, provider_name)
            sample = "\n\n".join(texts)[:6000]
            prompt = (
                "Rate this author's writing VOICE on each axis from 0 to 100, judging only "
                "from the samples. 0 = left pole, 100 = right pole.\n"
                "- casual: formal(0) … casual(100)\n"
                "- vivid: plain(0) … vivid/sensory(100)\n"
                "- punchy: long-flowing(0) … short-punchy(100)\n"
                "- warm: detached(0) … warm(100)\n"
                "- concrete: abstract(0) … concrete/specific(100)\n"
                "- direct: hedged(0) … direct(100)\n\n"
                "Return ONLY a JSON object with those six integer keys.\n\nSAMPLES:\n" + sample
            )
            resp = await prov.complete(
                model=_default_model(provider_name), prompt=prompt, json_schema=_DIM_SCHEMA
            )
            raw = json.loads(resp.text)
            dimensions = {k: max(0, min(100, int(raw.get(k, 50)))) for k in _DIMENSIONS}
        except Exception as exc:  # noqa: BLE001 — dimensions are best-effort
            logger.warning("fingerprint dimensions failed: %r", exc)
            dimensions = None

    return {
        "name": profile.name or "Your voice",
        "one_line": profile.persona_one_line,
        "strength": strength,
        "sample_count": n_samples,
        "dimensions": dimensions,
        "signature_phrases": stats["signature_phrases"],
        "top_words": stats["top_words"],
        "rhythm": stats["rhythm"],
        "avg_sentence_len": stats["avg_sentence_len"],
        "banished": list(profile.rules.banished_words)[:6],
    }
