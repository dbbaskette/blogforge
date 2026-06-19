# Import from LinkedIn (data export) → Your Voice prefill — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design), pending implementation plan.
**Scope:** Let a user upload their LinkedIn **"Get a copy of your data"** archive on the Your Voice page; parse Profile + Articles and prefill the voice persona + seed writing samples. LinkedIn blocks all server-side scraping (verified: HTTP 999 for browser UAs, crawler UAs, and curl_cffi TLS impersonation), so the data-export upload is the legitimate, complete path.

## Verified archive format (from a real export)
- `Profile.csv` — one row; columns include `First Name, Last Name, …, Headline, Summary, Industry, …`. **Headline** = the professional tagline; **Summary** = the About text (~760 chars).
- `Articles/Articles/*.html` — one HTML file per LinkedIn article (7 in the sample). `trafilatura.extract()` (already a dependency) returns clean article text; `<title>` holds the article title.
- The download may arrive double-extensioned (`*.zip.zip`); the inner file is a normal zip.

## Goal
- On Your Voice, a walk-through + an upload control: the user uploads the archive, and we prefill **identity / one-line / tone** and add their **About + each article** as writing samples, so the existing **Distill** can build the real voice from genuine material.
- Works keyless on TP (the LLM step also accepts the bound `tanzu` model).

## Architecture

### 1 · Parser — `blogforge/voice/linkedin_import.py` (pure, unit-testable)
`parse_linkedin_archive(data: bytes) -> LinkedInProfile` where `LinkedInProfile = {headline: str, summary: str, articles: list[Article]}` and `Article = {title: str, text: str}`:
- Open `data` as a zip (`zipfile.ZipFile(io.BytesIO(data))`); if a single nested `.zip` is the only entry, recurse once.
- `Profile.csv` (case-insensitive match anywhere in the archive) → first row → `headline = row["Headline"]`, `summary = row["Summary"]` (tolerate missing columns → "").
- Every `*.html` under a path containing `articles/` → `title` from `<title>…</title>` (fallback: filename stem, de-slugified), `text` from `trafilatura.extract(html)`; skip entries that extract to empty/very short text. Strip a leading `Created on …/Published on …` line if present.
- Returns empty fields rather than raising on a partial/odd archive; raises `LinkedInImportError` only if no `Profile.csv` AND no articles are found (so the caller can 400 with a helpful message).

Also `build_persona_prompt(headline, summary) -> str` + a JSON schema `{identity, one_line, tone}` + `parse_persona(text) -> tuple[str,str,str]` (the LLM helpers; pure).

### 2 · Endpoint — `POST /api/voice/import/linkedin` (`api/voice.py`)
Multipart `file: UploadFile` (the archive), `provider: str | None`, `model: str | None` (form fields). `Depends(get_current_user)`:
1. Read the upload; `parse_linkedin_archive(bytes)` → profile. On `LinkedInImportError` → 400 `{error: linkedin_parse_failed, …}`.
2. **Persona prefill:** resolve a provider via the same logic as `distill` (body.provider, else auto-select the first available — now including `tanzu`). If a provider resolves, one `provider.complete(model, build_persona_prompt(...), json_schema=…)` call → `{identity, one_line, tone}`. If none resolves, fall back to `one_line = headline`, `identity = first sentence of summary`, `tone = ""`. Call `store.update_persona(current.id, identity, one_line, tone)`.
3. **Seed samples:** `add_text_sample(current.id, name="LinkedIn — About", text=summary)` (if summary non-empty) and, for each article, `add_text_sample(current.id, name=f"LinkedIn — {title}", text=article.text)`. (Samples carry no `source_url` here; they're pasted text.)
4. Return the updated `VoiceProfile` (so the UI shows the prefilled persona + new samples).
- Guardrails: reject files > ~10 MB; only accept `.zip`/`.csv` content; cap articles seeded at, say, 25.

### 3 · Provider auto-select fix
The existing `distill` endpoint's auto-select loop `("anthropic","openai","google","claude-cli")` **omits `tanzu`** — add it (after the keyed providers, before failing) so voice distillation + this import work keyless on TP with the bound model. (`build_provider_for` already supports `tanzu`.)

### 4 · Frontend — `routes/VoicePage.tsx` + `components/voice/LinkedInImportCard.tsx` (new) + `api/voice.ts`
- `api/voice.ts`: `importLinkedIn(file: File, provider?, model?): Promise<VoiceProfile>` (multipart POST).
- `LinkedInImportCard`: a collapsible card with
  - a numbered walk-through: *Settings & Privacy → Data Privacy → Get a copy of your data → select **Profile** (and **Articles**) → Request archive → wait for the email → download the `.zip`*, plus an **"Open LinkedIn data export ↗"** link (`https://www.linkedin.com/mypreferences/d/download-my-data`).
  - a file input (`.zip`) + an **Import** button → calls `importLinkedIn`, then refreshes the profile (parent reload) and shows a success line ("Prefilled your persona and added N writing samples — review below, then Distill").
  - inline error on a 400 (bad archive / no provider).
- Mounted on `VoicePage` near the Persona card.

## Testing
- **Parser** (`tests/voice/test_linkedin_import.py`): build a synthetic zip in-memory (a `Profile.csv` with Headline/Summary + one `Articles/Articles/x.html`) → assert headline/summary parsed and the article text extracted; a zip with neither → `LinkedInImportError`; a double-nested zip → recurses. (Optionally a slow/marked test against the real archive path if present, skipped otherwise.)
- **Endpoint** (`authed_client` + `BLOGFORGE_TEST_PROVIDER=mock`): POST a synthetic archive → 200, persona updated, samples count increased; no-provider + mock-off path falls back to headline/summary.
- **Auto-select**: a unit/asserting test that `tanzu` is considered when configured and no user key exists.
- Web `tsc` clean; a small `LinkedInImportCard` render test (walk-through steps + upload button).

## Out of scope
- Live LinkedIn fetching/scraping (blocked; verified).
- Positions/Education/Skills CSVs (only Profile + Articles for v1).
- Auto-running Distill after import (the user reviews, then clicks Distill).

## Success criteria
1. Uploading the LinkedIn export prefills persona one-line (Headline) + identity/tone, and adds the About + each article as writing samples; the user can then Distill into a full voice.
2. A malformed/empty archive returns a clear 400, not a 500.
3. Works on TP with the bound `tanzu` model and no personal key.
4. New parser/endpoint tests pass; existing suite + web `tsc` green.
