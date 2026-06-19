# Absorb myvoice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendor the used slice of the external `myvoice` package into `blogforge.voice`, rewire BlogForge to it, and drop the `myvoice` dependency — removing the only non-index dep and unblocking the Tanzu buildpack deploy.

**Architecture:** Copy `compose / lint / validate / ai_tells / packs/*` + their bundled resources from the sibling `myvoice` repo into `packages/api/blogforge/voice/`, internalize all `myvoice` self-references (imports + `resources.files`), rewire BlogForge's ~18 call sites, then strip the dependency from `pyproject.toml` / lockfiles / Dockerfile. Verbatim copy — no behavior change.

**Tech Stack:** Python 3.11, hatchling packaging, uv, pytest. macOS/BSD `sed` (`-i ''`).

> **Spec:** `docs/superpowers/specs/2026-06-19-absorb-myvoice-design.md`
> **Source repo:** `/Users/dbbaskette/Projects/myvoice/packages/api/myvoice/` (call it `$MV`).
> **Test command:** `cd /Users/dbbaskette/Projects/BlogForge && .venv/bin/python -m pytest <path> -q`

---

## File Structure
- Create `packages/api/blogforge/voice/` — vendored style-pack engine (one responsibility: compose/lint/validate/packs).
  - `compose.py`, `lint.py`, `validate.py`, `ai_tells.py`
  - `packs/{__init__,manifest,store,discovery,templates}.py`
  - `__init__.py` (public API re-exports)
  - `assets/writing-baseline.md`, `assets/ai-tells/{words,phrases,sentence-starters}.txt`, `assets/ai-tells/patterns.md`
  - `bundled_packs/_template/**`
- Modify ~18 BlogForge call sites (`generate/*`, `api/*`, `server.py`) — swap `myvoice` → `blogforge.voice`.
- Modify `pyproject.toml` (drop dep + source override, extend artifacts), `requirements.lock`, `uv.lock`, `packages/api/Dockerfile`.
- Create `packages/api/tests/voice/test_absorb.py`.

---

## Task 1: Create the `blogforge.voice` package (copy + internalize)

**Files:** Create `packages/api/blogforge/voice/**`; Test `packages/api/tests/voice/test_absorb.py`

- [ ] **Step 1: Write the failing test** `packages/api/tests/voice/test_absorb.py` (create `packages/api/tests/voice/__init__.py` too):
```python
from pathlib import Path

def test_public_api_imports() -> None:
    from blogforge.voice import (  # noqa: F401
        ComposeError, LintHit, Manifest, PackStore, Violation,
        compose_prompt, detect_ai_patterns, detect_positive_hits,
        lint, lint_to_hits, validate_pack,
    )

def test_ai_tells_resource_loads() -> None:
    from blogforge.voice.ai_tells import load_ai_tells
    t = load_ai_tells()
    assert t.words and t.phrases and t.patterns  # bundled resources resolved

def test_compose_prompt_smoke(tmp_path: Path) -> None:
    from blogforge.voice import compose_prompt
    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "stylepack.yaml").write_text(
        "schema_version: 1\nname: test\nvoice:\n  summary: Plain and direct.\n",
        encoding="utf-8",
    )
    (pack / "style-guide.md").write_text("Write plainly. Avoid jargon.\n", encoding="utf-8")
    out = compose_prompt(pack_root=pack, samples=[], draft="Hello world")
    assert "Write plainly" in out and "Hello world" in out

def test_validate_template_pack() -> None:
    from importlib import resources
    from blogforge.voice import validate_pack
    tmpl = resources.files("blogforge.voice").joinpath("bundled_packs/_template")
    res = validate_pack(Path(str(tmpl)))
    assert res is not None  # template validates (no exception/ok result)
```
> If `compose_prompt`'s real signature differs from `(pack_root=, samples=, draft=)`, adjust the call to the actual signature you copy in Step 3 (check `$MV/compose.py`'s `def compose(...)`). Keep the assertion that the style text + draft appear.

- [ ] **Step 2: Run → FAIL** `.venv/bin/python -m pytest packages/api/tests/voice/test_absorb.py -q` (ModuleNotFoundError: blogforge.voice).

- [ ] **Step 3: Copy the slice + resources.** Run from repo root:
```bash
cd /Users/dbbaskette/Projects/BlogForge
MV=/Users/dbbaskette/Projects/myvoice/packages/api/myvoice
DST=packages/api/blogforge/voice
mkdir -p "$DST/packs"
cp "$MV"/compose.py "$MV"/lint.py "$MV"/validate.py "$MV"/ai_tells.py "$DST"/
cp "$MV"/packs/__init__.py "$MV"/packs/manifest.py "$MV"/packs/store.py "$MV"/packs/discovery.py "$MV"/packs/templates.py "$DST"/packs/
# resources
mkdir -p "$DST/assets/ai-tells"
cp "$MV"/assets/writing-baseline.md "$DST"/assets/
cp "$MV"/assets/ai-tells/words.txt "$MV"/assets/ai-tells/phrases.txt "$MV"/assets/ai-tells/sentence-starters.txt "$MV"/assets/ai-tells/patterns.md "$DST"/assets/ai-tells/
cp -R "$MV"/bundled_packs "$DST"/bundled_packs
find "$DST" -name .DS_Store -delete
```

- [ ] **Step 4: Internalize the copied files' self-references** (imports + resource lookups). The anchored sed only rewrites real import statements (line-start, after indent), so comments/paths like `~/.myvoice` are untouched:
```bash
cd /Users/dbbaskette/Projects/BlogForge
find packages/api/blogforge/voice -name '*.py' -exec sed -i '' -E \
  -e 's/^([[:space:]]*)from myvoice/\1from blogforge.voice/' \
  -e 's/^([[:space:]]*)import myvoice/\1import blogforge.voice/' \
  -e 's/resources\.files\("myvoice"\)/resources.files("blogforge.voice")/g' {} +
# verify nothing still references the old package name in code
grep -rnE "(^[[:space:]]*(from|import) myvoice)|resources\.files\(\"myvoice\"\)" packages/api/blogforge/voice && echo "STILL HAS myvoice refs ^" || echo "internalized OK"
```

- [ ] **Step 5: Replace `__init__.py` with the public API** `packages/api/blogforge/voice/__init__.py` (overwrite the copied one):
```python
"""blogforge.voice — the style-pack engine absorbed from the myvoice project
(github.com/dbbaskette/myvoice, same author, MIT). BlogForge vendors the used
slice (compose / lint / validate / packs) so it has no external dependency."""
from __future__ import annotations

from blogforge.voice.compose import ComposeError, compose as compose_prompt
from blogforge.voice.lint import (
    LintHit,
    Violation,
    detect_ai_patterns,
    detect_positive_hits,
    lint,
    lint_to_hits,
)
from blogforge.voice.packs.manifest import Manifest
from blogforge.voice.packs.store import PackStore
from blogforge.voice.validate import validate_pack

__all__ = [
    "ComposeError", "LintHit", "Manifest", "PackStore", "Violation",
    "compose_prompt", "detect_ai_patterns", "detect_positive_hits",
    "lint", "lint_to_hits", "validate_pack",
]
```
> If `lint.py` doesn't define one of `detect_ai_patterns`/`Violation` (grep `$MV/lint.py`), import only what exists and trim `__all__` + the test's import list to match.

- [ ] **Step 6: Run → PASS** `.venv/bin/python -m pytest packages/api/tests/voice/test_absorb.py -q` (4 passed). Fix any import error by checking the real symbol names in the copied modules. Confirm the slice pulls no unexpected dep: `grep -rn "jsonschema\|watchfiles" packages/api/blogforge/voice || echo "no extra deps ✓"`.

- [ ] **Step 7: Commit**
```bash
git add packages/api/blogforge/voice packages/api/tests/voice
git commit -m "feat(voice): vendor myvoice used slice into blogforge.voice"
```

---

## Task 2: Rewire BlogForge to `blogforge.voice` + prove independence + drop the dep

**Files:** Modify `packages/api/blogforge/{generate,api}/*.py`, `server.py`, `pyproject.toml`; Test `packages/api/tests/voice/test_no_myvoice_imports.py`

- [ ] **Step 1: Rewrite the call sites** (everything except the vendored package itself):
```bash
cd /Users/dbbaskette/Projects/BlogForge
find packages/api/blogforge -name '*.py' -not -path '*/voice/*' -exec sed -i '' -E \
  -e 's/^([[:space:]]*)from myvoice/\1from blogforge.voice/' \
  -e 's/^([[:space:]]*)import myvoice/\1import blogforge.voice/' {} +
git diff --stat
```

- [ ] **Step 2: Verify no stray references + review the diff** (catch any comment the anchored sed intentionally skipped — those are fine; ensure only import lines changed):
```bash
grep -rnE "^[[:space:]]*(from|import) myvoice" packages/api/blogforge && echo "STILL IMPORTS myvoice ^" || echo "no myvoice imports remain ✓"
```

- [ ] **Step 3: Run the full suite (myvoice still installed) → green:**
```bash
.venv/bin/python -m pytest packages/api -q
```
Expected: 0 failures (the app now imports `blogforge.voice`; `myvoice` is still installed but unused).

- [ ] **Step 4: PROVE independence — uninstall myvoice, rerun:**
```bash
.venv/bin/python -m pip uninstall -y myvoice 2>/dev/null || .venv/bin/uv pip uninstall myvoice
.venv/bin/python -c "import blogforge.server; print('app imports without myvoice ✓')"
.venv/bin/python -m pytest packages/api -q
```
Expected: import line prints, suite 0 failures with `myvoice` absent from the venv. If anything fails, a call site was missed — grep, fix, rerun.

- [ ] **Step 5: Add the guard test** `packages/api/tests/voice/test_no_myvoice_imports.py`:
```python
import subprocess
from pathlib import Path

def test_no_myvoice_imports_in_source() -> None:
    root = Path(__file__).resolve().parents[2] / "blogforge"
    hits = subprocess.run(
        ["grep", "-rnE", r"^[[:space:]]*(from|import) myvoice", str(root)],
        capture_output=True, text=True,
    ).stdout.strip()
    assert hits == "", f"myvoice import(s) crept back:\n{hits}"
```

- [ ] **Step 6: Drop the dependency** in `pyproject.toml`: delete the `"myvoice>=0.1.0",` line from `[project].dependencies`, and delete the entire `[tool.uv.sources]` block (the `myvoice = { path = "../myvoice", editable = true }` entry — remove the header too if it leaves the section empty).

- [ ] **Step 7: Run the guard + full suite → PASS:**
```bash
.venv/bin/python -m pytest packages/api/tests/voice -q
.venv/bin/python -m pytest packages/api -q
```

- [ ] **Step 8: Commit**
```bash
git add packages/api/blogforge pyproject.toml packages/api/tests/voice
git commit -m "refactor: import the style engine from blogforge.voice; drop myvoice dependency"
```

---

## Task 3: Packaging, lockfiles, Dockerfile cleanup

**Files:** Modify `pyproject.toml`, `requirements.lock`, `uv.lock`, `packages/api/Dockerfile`

- [ ] **Step 1: Ship the vendored resources in the wheel.** In `pyproject.toml`, update the hatch artifacts to include the voice assets + bundled packs:
```toml
[tool.hatch.build]
artifacts = [
    "packages/api/blogforge/static/**/*",
    "packages/api/blogforge/voice/assets/**/*",
    "packages/api/blogforge/voice/bundled_packs/**/*",
]
```

- [ ] **Step 2: Verify the wheel includes the resources:**
```bash
cd /Users/dbbaskette/Projects/BlogForge
.venv/bin/python -m build --wheel -o /tmp/bf-wheel 2>/dev/null || .venv/bin/uv build --wheel -o /tmp/bf-wheel
python -c "import zipfile,glob; w=sorted(glob.glob('/tmp/bf-wheel/*.whl'))[-1]; n=zipfile.ZipFile(w).namelist(); \
print('writing-baseline:', any('voice/assets/writing-baseline.md' in x for x in n)); \
print('ai-tells/words:', any('voice/assets/ai-tells/words.txt' in x for x in n)); \
print('bundled _template:', any('voice/bundled_packs/_template/stylepack.yaml' in x for x in n))"
rm -rf /tmp/bf-wheel
```
Expected: all three `True`. If any is `False`, the artifacts glob isn't catching that file type — add an explicit `force-include` or list the path, and re-verify.

- [ ] **Step 3: Regenerate the lockfiles without myvoice:**
```bash
.venv/bin/uv lock
.venv/bin/uv export --frozen --no-emit-project --no-dev --no-hashes -o requirements.lock
grep -nE "myvoice|-e \.\./myvoice" requirements.lock uv.lock && echo "STILL references myvoice ^" || echo "locks clean ✓"
```

- [ ] **Step 4: Remove the myvoice clone from the Dockerfile.** In `packages/api/Dockerfile`, delete the `ARG MYVOICE_REF=main` line, the `RUN git clone … /myvoice` block, and the explanatory comment paragraph above it that references the `[tool.uv.sources]` override. Leave the rest (uv install from `requirements.lock`, the web stage, the static copy, the `-e .` install) intact.

- [ ] **Step 5: Sanity-check the Dockerfile still references only present files:**
```bash
grep -nE "myvoice|MYVOICE" packages/api/Dockerfile && echo "STILL mentions myvoice ^" || echo "Dockerfile clean ✓"
```

- [ ] **Step 6: Final full suite (with myvoice uninstalled from Task 2) → green:**
```bash
.venv/bin/python -m pytest packages/api -q
```

- [ ] **Step 7: Commit**
```bash
git add pyproject.toml requirements.lock uv.lock packages/api/Dockerfile
git commit -m "build: ship blogforge.voice resources; drop myvoice from locks + Dockerfile"
```

---

## Self-Review Notes
- **Spec coverage:** new package + internalize → T1; call-site rewire + dep removal + guard → T2; packaging/locks/Dockerfile → T3; resources shipped → T3/Step 2; tests + independence proof → T1/T2. Immediate AI-tell expansion is intentionally a separate follow-up (spec §"Immediate follow-up").
- **Type/name consistency:** the `blogforge.voice` public names in T1/Step 5 match the test imports (T1/Step 1) and the guard (T2). `compose_prompt = compose.compose`, `ComposeError` from `.compose`.
- **Adapt-on-contact:** real `compose()` signature (T1/Step 1+6), actual `lint.py` symbol names (T1/Step 5), and wheel artifact globs for `.txt`/`.md`/`.gitkeep` (T3/Step 2) — verify against the copied source and adjust as noted inline.
- **Safety:** Task 2 proves independence by *uninstalling* myvoice and running the suite, so a missed call site fails loudly rather than silently relying on the still-installed package.
