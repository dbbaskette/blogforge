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

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.voice.ingest import add_file_sample, add_text_sample, add_url_sample, add_url_source
from blogforge.voice.models import VoiceProfile, VoiceRules, VoiceSample, VoiceSource
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


@router.post("/distill")
async def distill(
    body: _DistillBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> VoiceProfile:
    """Run LLM-based style distillation over the user's samples and store the result."""
    from blogforge.keys import KeyVault
    from blogforge.llm.registry import get_provider
    from blogforge.s3 import get_s3_client
    from blogforge.voice.distill import distill_style

    store = _store(request)
    profile = await store.get_or_create(current.id)

    # --- resolve provider ---
    if body.provider:
        provider_name = body.provider
        # When provider is explicitly given, fetch key but allow mock to short-circuit.
        import os
        if os.environ.get("BLOGFORGE_TEST_PROVIDER") == "mock":
            api_key = "mock"
        else:
            api_key = await KeyVault().get(provider_name)
            if not api_key:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": {
                            "code": "provider_missing_key",
                            "message": f"No API key for {provider_name}",
                            "hint": "An admin can add one under /admin (API keys section).",
                        }
                    },
                )
    else:
        # Auto-select: first provider that has a key.
        vault = KeyVault()
        provider_name = None
        api_key = ""
        for candidate in ("anthropic", "openai", "google", "claude-cli"):
            key = await vault.get(candidate)
            if key:
                provider_name = candidate
                api_key = key
                break
        if provider_name is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "code": "provider_missing_key",
                        "message": "No API key configured for any provider.",
                        "hint": "An admin can add one under /admin (API keys section).",
                    }
                },
            )

    model = body.model or _PROVIDER_DEFAULTS.get(provider_name, "claude-sonnet-4-6")
    provider = get_provider(provider_name, api_key)

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
