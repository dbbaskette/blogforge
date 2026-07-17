# Codex Draft Provider Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `codex-cli` a valid, persistable provider for drafts and every draft-adjacent request so existing drafts can switch to the authenticated Codex CLI and Humanize can resolve it.

**Architecture:** Define one backend `TextProvider` literal as the source of truth and reuse it in draft, import, template, and topic request models. The web types and selector already support Codex. Route tests prove Codex survives create/import/update persistence, while a Humanize route test proves a Codex-backed draft reaches provider resolution.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, pytest, existing BlogForge mock LLM provider.

## Global Constraints

- Preserve the distinction between the user's default provider and each draft's stored provider.
- Do not migrate existing drafts automatically.
- Use `codex-default` as the Codex CLI model.
- Preserve validation for unknown providers and all existing providers.
- Do not include the admin log viewer or general punctuation checking in this hotfix.

---

### Task 1: Centralize and apply the backend text-provider type

**Files:**
- Create: `packages/api/blogforge/llm/types.py`
- Modify: `packages/api/blogforge/drafts/models.py`
- Modify: `packages/api/blogforge/api/drafts.py`
- Modify: `packages/api/blogforge/templates/models.py`
- Modify: `packages/api/blogforge/api/topics.py`
- Test: `packages/api/tests/test_idea_input_validation.py`

**Interfaces:**
- Produces: `TextProvider = Literal["anthropic", "openai", "google", "claude-cli", "codex-cli", "tanzu"]`.
- Consumers: Pydantic fields named `provider` in `IdeaInput`, `_ImportBody`, `TemplateInput`, and `_TopicsBody`.

- [ ] **Step 1: Write the failing model tests**

Add tests that instantiate `IdeaInput`, `TemplateInput`, and `_TopicsBody` with `provider="codex-cli"`, `model="codex-default"`, and assert the provider survives validation. Add one parameterized test proving an unknown provider remains rejected.

- [ ] **Step 2: Run the tests and verify red**

Run:

```bash
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run pytest packages/api/tests/test_idea_input_validation.py -q
```

Expected: the Codex cases fail with Pydantic literal validation errors.

- [ ] **Step 3: Add and use the shared provider type**

Create `blogforge/llm/types.py` with:

```python
from typing import Literal

TextProvider = Literal[
    "anthropic", "openai", "google", "claude-cli", "codex-cli", "tanzu"
]
```

Replace the four duplicated provider literals with `TextProvider`. Remove `Literal` imports only where no longer used.

- [ ] **Step 4: Run the model tests and Ruff**

Run:

```bash
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run pytest packages/api/tests/test_idea_input_validation.py -q
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run ruff check packages/api/blogforge/llm/types.py packages/api/blogforge/drafts/models.py packages/api/blogforge/api/drafts.py packages/api/blogforge/templates/models.py packages/api/blogforge/api/topics.py packages/api/tests/test_idea_input_validation.py
```

Expected: all tests pass and Ruff reports no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/llm/types.py packages/api/blogforge/drafts/models.py packages/api/blogforge/api/drafts.py packages/api/blogforge/templates/models.py packages/api/blogforge/api/topics.py packages/api/tests/test_idea_input_validation.py
git commit -m "fix(providers): allow Codex in draft schemas"
```

### Task 2: Prove Codex draft persistence and Humanize resolution

**Files:**
- Modify: `packages/api/tests/api/test_drafts_route.py`
- Modify: `packages/api/tests/api/test_templates_route.py`
- Modify: `packages/api/tests/api/test_humanize_route.py`

**Interfaces:**
- Consumes: the `TextProvider` validation applied in Task 1.
- Produces: regression coverage for the exact user flow: persist Codex on a draft, then invoke Humanize through the stored provider.

- [ ] **Step 1: Add route regression tests**

Add tests that:

1. POST `/api/drafts` with `codex-cli` / `codex-default` and assert the response retains both values.
2. POST `/api/drafts/import` with the same provider/model and assert persistence.
3. Create an ordinary draft, change `body["idea"]["provider"]` and `model`, PUT it back, GET it again, and assert Codex persists.
4. POST `/api/templates` with Codex and assert the stored template retains it.

- [ ] **Step 2: Run the route tests**

Run:

```bash
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run pytest packages/api/tests/api/test_drafts_route.py packages/api/tests/api/test_templates_route.py -q
```

Expected: all route tests pass; before Task 1 these new cases would return HTTP 422.

- [ ] **Step 3: Add a Humanize stored-provider test**

In `test_humanize_route.py`, create the draft with `provider="codex-cli"` and `model="codex-default"` while `BLOGFORGE_TEST_PROVIDER=mock`, invoke `/humanize`, and assert HTTP 200 plus the expected report. The mock environment deliberately preserves the route's stored provider path without launching a real Codex subprocess.

- [ ] **Step 4: Run focused and related suites**

Run:

```bash
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run pytest packages/api/tests/api/test_drafts_route.py packages/api/tests/api/test_templates_route.py packages/api/tests/api/test_humanize_route.py packages/api/tests/llm/test_resolve.py packages/api/tests/test_codex_cli.py packages/api/tests/test_default_provider.py -q
UV_CACHE_DIR=/tmp/blogforge-uv-cache uv run ruff check packages/api/tests/api/test_drafts_route.py packages/api/tests/api/test_templates_route.py packages/api/tests/api/test_humanize_route.py
scripts/version.sh check
git diff --check
```

Expected: all tests and static checks pass; version remains `0.7.0`.

- [ ] **Step 5: Commit**

```bash
git add packages/api/tests/api/test_drafts_route.py packages/api/tests/api/test_templates_route.py packages/api/tests/api/test_humanize_route.py
git commit -m "test(providers): cover Codex-backed drafts"
```

### Task 3: Review, merge, deploy, and verify

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: the complete tested hotfix branch.
- Produces: merged `main` and a healthy production deployment where existing drafts can persist Codex CLI.

- [ ] **Step 1: Run final verification**

Run all focused tests from Task 2, shell syntax for deployment scripts, `git diff --check`, and inspect `git status --short` to ensure `.pnpm-store/` remains untracked and unstaged.

- [ ] **Step 2: Request independent code review**

Provide the reviewer with the spec path, plan path, base SHA, and head SHA. Resolve every Critical or Important finding before proceeding.

- [ ] **Step 3: Push and open the PR**

Push `codex/fix-codex-draft-provider`, create a focused PR describing the reproduced Pydantic failure and tests, and verify mergeability/security checks.

- [ ] **Step 4: Merge and deploy**

Squash-merge the PR, return the primary checkout to merged `main`, and run:

```bash
./scripts/deploy-home.sh
```

Expected: remote fast-forward, build, sync, restart, and both health endpoints succeed on version `0.7.0`.

- [ ] **Step 5: Verify the operator workflow**

Confirm the deployed API accepts a Codex-backed draft update through automated route coverage and production health. Tell the operator to open the affected draft's Setup panel, select `Codex CLI (subscription)` / `Codex default`, wait for save, and rerun Humanize. If it still returns 502, the now-correct provider error path should be diagnosed from the production service log as a genuine Codex execution failure.
