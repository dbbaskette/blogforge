# Voice Background Sources — Design Spec

**Date:** 2026-06-18
**Status:** Built (part of the Lint+Interview+Sources batch).
**Scope:** Add profile-level **background/context sources** (URLs) to a user's Voice profile. Unlike style samples, these supply *facts* — product info, terminology — that generation can draw on. Their extracted content is injected into the reference context when writing in that voice.

## Goal
"As part of a user's voice, include some websites for background information used for context (not style) — e.g. `tanzu.vmware.com` so a blog can use product facts." Background sources live on the Voice profile, are reusable across every draft in that voice, and feed the model factual grounding at generation time.

## Decisions
- **Separate from style samples.** A dedicated `voice_sources` table (not `voice_samples`) so sources never pollute style distillation or the exemplar pack. Mirrors the samples feature's storage/ingest pattern but kept distinct.
- **URL-only (MVP).** Sources are URLs, fetched+extracted via the existing `extract_url` (trafilatura) — the same path samples and references use. (Text/file sources are a later enhancement.)
- **Live injection.** At generation, the profile's source content is assembled into a "## Background sources" block and prepended to the reference context for the main compose path and ideation. No per-draft copy.

## Architecture
**Backend (migration 0014):**
- ORM `VoiceSource` (`voice_sources`): `id`, `profile_id` (FK → voice_profiles, CASCADE), `url`, `name`, `s3_key`, `extracted_chars`, `status`, `added_at`. Mirrors `VoiceSample` minus kind/exemplar/file fields.
- Pydantic `VoiceSource` + `_source_from_row`.
- `SqlVoiceStore`: `add_source`, `list_sources(user_id)`, `delete_source(user_id, id)` — mirrors the sample methods; bumps profile version.
- `voice/ingest.py`: `add_url_source(user_id, url)` — reuse `extract_url`; store markdown at `voice/{profile_id}/sources/{id}.md`; `status="failed"` on fetch error (row still created).
- `voice/sources_context.py`: `async build_background_context(user_id) -> str` — load the profile's ready sources, read each S3 markdown (truncated per-source + overall budget), format as a "## Background sources" block (or "" if none).
- Injection: in `api/expand.py` and `api/ideation.py`, prepend `build_background_context(user_id)` to the `reference_context` before generation.

**Backend API (`api/voice.py`):**
- `POST /api/voice/sources {url}` → ingest + return `VoiceSource`.
- `GET /api/voice/sources` → list.
- `DELETE /api/voice/sources/{id}`.

**Frontend:**
- `api/voice.ts`: `VoiceSource` type + `listSources` / `addUrlSource` / `deleteSource`.
- A "Background sources" card on the **Your Voice** screen (mirrors `SamplesList`): add a URL, list sources with status, delete. Copy clarifies these are for *facts/context*, not style.

## Testing
- Backend: store round-trip (add → list → delete, version bump, user-scoped); `build_background_context` formats ready sources and ignores failed/empty; ORM round-trip for the migration.
- Frontend: minimal — the sources card renders + add/delete call the client (or at least typechecks + suite stays green).

## Out of scope
- Text/file sources (URL-only for now).
- Live re-fetch/refresh scheduling (content is extracted at add time; re-add to refresh).
- Injecting into inline-edit / fact-check paths (compose + ideation cover the core value).

## Success criteria
Adding `tanzu.vmware.com` as a background source on the profile makes its extracted content part of the reference context for drafts written in that voice; managing sources lives in Your Voice; migration + tests pass.
