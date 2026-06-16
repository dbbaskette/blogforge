# Voice Profile & Samples — design

**Date:** 2026-06-16
**Status:** Approved (brainstorm), pending implementation plan
**Sub-project of:** BlogForge v2 reimagining (1 of 3 — see "Relationship to v2" below)

## Summary

Give each user a first-class **voice profile**: a persona, an explicit rule set, a
growing **library of writing samples** (pasted text, URLs, or uploaded files), and an
editable **distilled style** the system learns from those samples. The profile is a real,
portable [myvoice](https://github.com/dbbaskette/myvoice) pack — stored natively in
BlogForge and materialized to a pack on demand for generation and export. Once set up, a
user's profile is the default voice for every draft they write.

This replaces today's model, where "voice" is a read-only myvoice pack chosen per draft and
samples live only inside the pack files.

## Goals

- A per-user voice profile (one per user for v1) editable in the app.
- A sample library users grow over time: paste text, add a URL, or upload a file. Star
  which samples are used as live exemplars during generation.
- Distillation: an on-demand LLM pass over the samples produces an editable `style-guide.md`
  ("distilled style") the user can see and tweak.
- The profile drives generation as a real myvoice pack, with `compose_prompt` unchanged.
- Portability: "Download as myvoice pack" produces a pack reusable in the myvoice CLI and
  other tools.

## Non-goals (out of scope for this spec)

- Multiple named profiles per user (v1 is one profile per user).
- Breaking the distilled style into individually-editable facets (tone / sentence style /
  vocabulary / do's & don'ts). Single editable markdown blob for v1.
- A "test this voice on a paragraph" live preview (fast-follow).
- Automatic distillation on every sample change (distill is a manual button; the UI nudges
  when samples have changed since the last distill).
- The information-architecture rework (where "Your Voice" sits, the setup→write flow) — that
  is **sub-project B**. This spec adds "Your Voice" as a new top-level area; B reorganizes
  navigation around it.
- The vibrant liquid-glass visual overhaul — **sub-project C**. Screens here use the current
  design system; C reskins them.

## Relationship to v2

The v2 reimagining decomposes into three specs built in order:

1. **Voice Profile & Samples** (this spec) — the foundation.
2. **Reimagined writing flow** (B) — profile-setup vs assisted-writing, outline-in /
   outline-proposed. Depends on this.
3. **Liquid-glass visual system** (C) — cross-cutting reskin, applied after A/B screens exist.

## Architecture

**Approach: native storage + materialize-on-demand.** The profile and samples live in
BlogForge's own tables and S3. At generation time — and for export — BlogForge writes a real
myvoice pack to a temp directory from that data and calls `compose_prompt` on it unchanged.

This was chosen over (a) editing per-user pack directories in place (awkward file-based
management in a multi-user web app) and (b) BlogForge assembling the voice prompt itself
(forks `compose_prompt`, loses the myvoice engine).

### Components

Each component has one job and a narrow interface.

- `blogforge.voice.models` — Pydantic shapes (`VoiceProfile`, `VoiceSample`).
- `blogforge.db.models` — ORM rows `VoiceProfile`, `VoiceSample` (new tables).
- `blogforge.voice.store.SqlVoiceStore` — CRUD for profiles + samples; mirrors
  `drafts.sql_store`.
- Sample ingestion — **reuses the references pipeline** (URL fetch via trafilatura, file
  extraction, text paste → extracted markdown in S3). Samples are stored exactly like
  references, under a `voice/{profile_id}/samples/{id}.md` S3 prefix.
- `blogforge.voice.distill.distill_style(sample_texts, provider, *, model) -> str` — one
  structured LLM pass → `distilled_style_md`.
- `blogforge.voice.pack.materialize(profile, samples) -> Path` — write a transient myvoice
  pack (`stylepack.yaml`, `style-guide.md`, `samples/*.md`) into a temp dir; cached by
  `profile.version`. `export_zip(profile, samples) -> bytes` reuses the same writer.
- `blogforge.voice.resolve.resolve_voice(draft, user) -> PackInfo-like` — central helper the
  generation routes call to get a `pack_root`: a materialized profile pack (default) or a
  myvoice pack by slug (advanced / legacy).
- `blogforge.api.voice` — REST: profile get/update, sample add/list/delete, toggle exemplar,
  distill, export.
- Web: `routes/VoicePage.tsx` + `components/voice/*` (Persona, Rules, SamplesList,
  DistilledStyle), `api/voice.ts`, a nav entry.

### Data model

`voice_profiles` (one row per user for v1; `user_id` unique):

| field | type | notes |
|-------|------|-------|
| id | uuid | pk |
| user_id | uuid fk | unique — one profile per user |
| name | str | default "My Voice" |
| persona_identity | str | e.g. "The builder who gets it" |
| persona_one_line | str | |
| persona_tone | str | e.g. "energetic, definitive, transparent" |
| rules | json | `{ banished_words: [], banished_phrases: [], no_em_dashes: bool, no_ascii_double_hyphen: bool }` |
| distilled_style_md | text | editable; becomes `style-guide.md` |
| distilled_at | datetime null | when distill last ran |
| version | int | bumps on any change → cache key for materialization |
| created_at / updated_at | datetime | |

`voice_samples`:

| field | type | notes |
|-------|------|-------|
| id | uuid | pk |
| profile_id | uuid fk | |
| kind | str | `text` \| `url` \| `file` |
| name | str | title / display name |
| source_url | str null | for `url` |
| original_filename | str null | for `file` |
| s3_key | str | extracted markdown text |
| extracted_chars | int | |
| exemplar | bool | use as a live example during generation |
| status | str | `ready` \| `failed` (extraction) |
| added_at | datetime | |

### Data flow

**Add sample:** request (text/url/file) → references-style extractor → markdown to S3 →
`voice_samples` row (`status=ready`) → profile marked stale (`version++`, distill considered
out of date).

**Distill:** user clicks Distill → load sample texts from S3 → `distill_style(...)` → write
`distilled_style_md`, set `distilled_at`, `version++`. On failure, keep the previous
`distilled_style_md` and surface the error.

**Generate (per draft):** `resolve_voice(draft, user)` → if the draft uses the profile
(default), `materialize(profile, exemplar_samples)` returns a cached temp pack dir (rebuilt
only when `version` changed) → existing generation code calls `compose_prompt(pack_root, …)`
unchanged.

**Export:** `export_zip(profile, samples)` → same pack writer → download.

### Generation integration

A draft records its voice as either the user's profile (default) or a myvoice pack slug
(advanced/legacy). `IdeaInput` gains `use_voice_profile: bool` (default `true` for new
drafts); when `true`, `resolve_voice` materializes the user's profile pack; when `false`, it
falls back to `pack_store.get(pack_slug)` as today. All
existing call sites (`expand`, `section`, `revise`, `outline`, `inline`, `repurpose`,
`headlines`, `document`) go through `resolve_voice`, so the change is centralized. New drafts
default to the user's profile; pack selection remains available as an advanced option.

## UI: the "Your Voice" screen

A new top-level area with four cards (validated via mockup):

1. **Persona** — identity, one-liner, tone (editable fields).
2. **Rules** — banished words/phrases as removable chips + rule toggles (no em-dashes, no
   ascii double-hyphen). The explicit, rule-based layer.
3. **Samples** — list with a kind icon (text/url/file), title, word count, a ★ exemplar
   toggle, and delete; an "Add sample" row (Paste text / Add URL / Upload file). A badge
   warns when samples changed since the last distill.
4. **Distilled style** — the editable distilled markdown, with a "Re-distill" button.

Header shows status ("distilled N days ago · M samples · used by default") and **Download
pack**. Visual polish (liquid-glass) is sub-project C.

## Error handling

- Sample extraction failure (bad URL, unreadable file) → sample saved with `status=failed`,
  shown inline, retryable; never blocks the profile (same as references today).
- Distill failure → previous `distilled_style_md` retained; error surfaced; `version`
  unchanged.
- Empty profile / no exemplars → generation falls back to persona + rules + distilled style;
  a brand-new profile with nothing set falls back to a base starter pack so generation never
  hard-fails.
- Missing profile (shouldn't happen — created on first visit) → seed from starter pack.

## Empty / onboarding state

On first visit to "Your Voice", a profile is created seeded from a starter pack (e.g. `dan`)
or blank, the user's choice. With no samples, distilled style is empty and generation uses
persona + rules. (The full onboarding flow belongs to sub-project B.)

## Testing

- Unit: `materialize()` writes a valid pack (`stylepack.yaml` + `style-guide.md` +
  `samples/*.md`) that `compose_prompt` accepts; `distill_style()` prompt shape + parsing via
  the mock provider; sample ingestion reuses references extraction; `resolve_voice` picks
  profile vs slug correctly; export zip contains the expected files.
- Integration: compose a draft whose voice is a materialized profile pack, end-to-end via the
  mock provider (one section ready).
- Migration test: the two new tables round-trip a profile + samples.

## Migrations

One Alembic migration adds `voice_profiles` and `voice_samples`.

## Open questions

None blocking. Revisit after v1: facet-based distilled style, multiple profiles, automatic
distillation, and the "test voice on a paragraph" preview.
