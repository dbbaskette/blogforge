# Absorb myvoice into BlogForge — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design), pending implementation plan.
**Scope:** Vendor the *used slice* of the external `myvoice` package into `blogforge.voice`, drop the `myvoice` dependency, and rewire BlogForge to its internal copy. Removes the only non-index dependency, which **unblocks the Tanzu buildpack deploy** and collapses the product to a single codebase. First of three: **Absorb → Deploy → Voice export**.

## Goal
- No external `myvoice` dependency: BlogForge imports everything from `blogforge.voice`.
- Behavior unchanged — the existing suite stays green; compose/lint/pack-loading work identically.
- Zero new third-party dependencies (the slice uses only `yaml` + `pydantic`, already present).

## Decisions (locked)
- Absorb **only the used slice** (compose / lint / validate / packs / ai_tells), not myvoice's own server, CLI, LLM registry, or extractor (BlogForge has its own).
- Sequence: **Absorb (this spec) → Deploy (buildpack) → Voice Markdown export.**
- The standalone `myvoice` repo remains as the historical origin; BlogForge stops depending on it. A short NOTICE comment in `blogforge/voice/__init__.py` credits the origin (same author, MIT).

## What BlogForge uses from myvoice (the full surface)
- `compose_prompt` (= `compose.compose`) + `ComposeError` — 15 call sites in `generate/*` and `api/*`.
- `lint`, `lint_to_hits`, `detect_positive_hits` (+ `LintHit`, `Violation`, `detect_ai_patterns`) — `api/lint.py`.
- `validate_pack` — `api/lint.py`.
- `PackStore` — `server.py` (`app.state.pack_store = PackStore(_resolve_pack_roots())`).
- `Manifest` — exported for typing.

## Internal closure to copy (verified import graph)
Self-contained; **does not touch `myvoice.llm` or `myvoice.extractor`** (confirmed). `compose_prompt` only *builds* a prompt string — BlogForge calls its own LLM with it.

Modules → `packages/api/blogforge/voice/`:
- `compose.py` → imports `ai_tells`, `packs.manifest`; loads `assets/writing-baseline.md` via `resources`.
- `lint.py` → imports `ai_tells`, `packs.manifest`.
- `validate.py` → imports `packs.manifest`; uses `pydantic` (NOT `jsonschema`).
- `ai_tells.py` → imports `packs.manifest`; loads `assets/ai-tells/*` via `resources`.
- `packs/__init__.py`, `packs/manifest.py` (leaf, `pydantic`), `packs/store.py` (→ `packs.discovery`), `packs/discovery.py` (→ `validate`), `packs/templates.py`.
- `__init__.py` — re-exports the public API.

Bundled resources → under `blogforge/voice/`:
- `assets/writing-baseline.md`
- `assets/ai-tells/{words.txt, phrases.txt, sentence-starters.txt, patterns.md}`
- `bundled_packs/_template/**` (the pack scaffold: `stylepack.yaml`, `style-guide.md`, `bios/*`, `formats/.gitkeep`, `samples/.gitkeep`)

## Architecture / changes

### 1 · New package `blogforge/voice/`
Copy the modules above. Convert internal imports to **relative** (`from .ai_tells import …`, `from .packs.manifest import …`, `from .validate import …`). Rewrite the two `resources.files("myvoice")` calls (in `compose.py` and `ai_tells.py`, plus any in `packs/*` that load `bundled_packs`) to `resources.files("blogforge.voice")`.

`blogforge/voice/__init__.py` re-exports the public API and a `ComposeError` convenience:
```python
from blogforge.voice.compose import compose as compose_prompt, ComposeError
from blogforge.voice.lint import (LintHit, Violation, detect_ai_patterns,
    detect_positive_hits, lint, lint_to_hits)
from blogforge.voice.packs.manifest import Manifest
from blogforge.voice.packs.store import PackStore
from blogforge.voice.validate import validate_pack
```

### 2 · Rewire BlogForge call sites (~18)
- `from myvoice.compose import ComposeError` → `from blogforge.voice.compose import ComposeError` (8 files).
- `from myvoice import compose_prompt` → `from blogforge.voice import compose_prompt` (7 files).
- `from myvoice import validate_pack` / `from myvoice.lint import detect_positive_hits, lint_to_hits` → `blogforge.voice…` (`api/lint.py`).
- `from myvoice import PackStore` → `from blogforge.voice import PackStore` (`server.py`).
- `server.py:_read_myvoice_pack_paths()` reads the user file `~/.myvoice/config.yaml` (NOT the `myvoice` module) — leave as-is. The "sibling myvoice repo" path fallbacks become vestigial but harmless; keep for now (they're filesystem probes that simply won't match).

### 3 · Dependencies & packaging (`pyproject.toml`)
- Remove `"myvoice>=0.1.0"` from `[project].dependencies`.
- Remove `[tool.uv.sources] myvoice = { path = "../myvoice", editable = true }`.
- Add **no** new dependency.
- Extend wheel artifacts so resources ship:
  `[tool.hatch.build] artifacts = ["packages/api/blogforge/static/**/*", "packages/api/blogforge/voice/assets/**/*", "packages/api/blogforge/voice/bundled_packs/**/*"]`
  (Confirm hatch includes these in the `packages/api/blogforge` wheel target; if `.gitkeep`/`.txt`/`.md` are excluded by default, list them explicitly.)

### 4 · Deploy pre-positioning (Dockerfile + lock)
- `packages/api/Dockerfile`: delete the `ARG MYVOICE_REF` + `git clone …/myvoice /myvoice` stage and the comment block referencing it.
- Regenerate `requirements.lock` without `-e ../myvoice`:
  `uv export --frozen --no-emit-project --no-dev --no-hashes -o requirements.lock` (after the pyproject edit; verify no `myvoice` / `-e ../myvoice` line remains).
- Update `uv.lock` via `uv lock` so it no longer references the path source.

## Testing
- **Existing suite green** — the full `packages/api` suite must pass unchanged after the rewrite (compose/lint/voice paths now resolve via `blogforge.voice`).
- New `packages/api/tests/voice/test_absorb.py`:
  - imports every public name from `blogforge.voice` (API parity).
  - `compose_prompt` smoke: build a prompt from a tiny on-disk pack (`stylepack.yaml` + `style-guide.md` in a tmp dir) and assert the baseline + style text appear.
  - bundled-resource load: `load_ai_tells()` returns non-empty `words`/`phrases`/`patterns` (proves `resources.files("blogforge.voice")` resolves).
  - `validate_pack` accepts the `bundled_packs/_template` pack.
- **Guard test:** assert no `from myvoice`/`import myvoice` remains in `packages/api/blogforge` (a source grep test), so the dependency can't silently creep back.

## Immediate follow-up (tracked, not in this spec)
Right after this lands: **expand the AI-tell rules** with the user's new data — additions to `blogforge/voice/assets/ai-tells/{words,phrases,sentence-starters}.txt` and `patterns.md` (plus a `lint.py` detector for any pattern needing active detection). Kept separate so this spec stays a pure refactor.

## Out of scope
- The Tanzu buildpack deploy (next sub-project — this only *unblocks* it).
- The portable voice Markdown export (later sub-project).
- Any behavior change to compose/lint/pack logic — verbatim copy only.

## Success criteria
1. `grep -r "myvoice" packages/api/blogforge` returns nothing (no imports, no dep, no source override).
2. Full `packages/api` test suite green; new `blogforge.voice` tests pass.
3. `blogforge/voice/assets/**` + `bundled_packs/**` resources load at runtime (compose + ai_tells + pack discovery work).
4. `requirements.lock`/`uv.lock`/Dockerfile no longer reference `myvoice`; `pip install -r requirements.lock` would need no external git source.
5. App boots and a generation round-trip (compose → LLM) works as before.
