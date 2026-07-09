# Prefer the Claude CLI Provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `claude-cli` the default/auto-selected LLM provider when the `claude` binary is installed, so the user's Max subscription is the default writing engine — everywhere except hero image generation (which stays on Google Imagen).

**Architecture:** Reverse two existing preference orders — the backend `_auto_select_provider` (voice routes) and the frontend compose default (`composeDefaults` + `SetupFields` fallback) — so claude-cli is tried first when available. Hero image is untouched (already hardcoded to Google). No new files; three small, test-first edits.

**Tech Stack:** Python 3.11 / pytest (backend), TypeScript / React / Vitest (frontend), launchd-supervised host deploy.

**Spec:** `docs/superpowers/specs/2026-07-08-prefer-claude-cli-provider-design.md`

## Global Constraints

- **"available" = installed** (`claude_available()`; the `claude` binary on PATH). No per-call auth probe.
- **Reversal of documented behavior:** the current code/tests intentionally prefer stored API keys over claude-cli ("respect the user's keys"). This change flips that — update the affected tests and comments, don't just add code.
- **Hero image unchanged** — `api/hero.py` stays hardcoded to the Google key.
- **Explicit choice wins** — only the *default/auto-selected* provider changes; an explicitly chosen provider (per-draft or user pick) is never overridden.
- **Server prerequisite (DONE):** `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) is set in the gitignored `.env.public`; clean-env `claude -p` verified working; the running service has the token. Deploy (Task 3) is therefore unblocked.
- **Branch:** `feat/prefer-claude-cli` (already created). Run backend tests with `uv run pytest`; frontend with `pnpm` (pinned to **pnpm@9**).

---

### Task 1: Backend — prefer claude-cli in `_auto_select_provider`

**Files:**
- Modify: `packages/api/blogforge/api/voice.py` (`_auto_select_provider`, ~lines 287-305)
- Test: `packages/api/tests/voice/test_auto_select_provider.py` (update existing — reverses behavior)

**Interfaces:**
- Produces: `_auto_select_provider(user_id) -> str | None` — now returns `"claude-cli"` first when `claude_available()`, else first stored vault key (`anthropic → openai → google`), else `"tanzu"`, else `None`.

- [ ] **Step 1: Update the test file to encode the new (reversed) rule**

Replace the module docstring and the `test_prefers_a_configured_api_key_over_claude_cli` test in `packages/api/tests/voice/test_auto_select_provider.py`. New content for those parts:

```python
"""`_auto_select_provider` — server-side provider default for keyless voice ops.

The rule: prefer the local `claude -p` CLI (keyless Max-subscription auth) when
it's installed, over stored API keys — the user's subscription is the default
writing engine. Fall back to a configured API key (anthropic > openai > google)
when the CLI isn't installed, then a bound Tanzu gateway, else nothing.
"""


async def test_prefers_claude_cli_over_a_configured_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # New rule: the installed CLI (subscription auth) wins over stored keys.
    monkeypatch.setattr("blogforge.llm.claude_cli.claude_available", lambda: True)
    user_id = uuid.uuid4()
    await KeyVault(user_id).set("openai", "sk-openai")
    assert await _auto_select_provider(user_id) == "claude-cli"


async def test_uses_api_key_when_cli_not_installed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # No CLI -> fall back to a configured vault key.
    monkeypatch.setattr("blogforge.llm.claude_cli.claude_available", lambda: False)
    user_id = uuid.uuid4()
    await KeyVault(user_id).set("openai", "sk-openai")
    assert await _auto_select_provider(user_id) == "openai"
```

(Keep the existing `test_falls_back_to_claude_cli_when_installed_and_no_keys` and `test_returns_none_when_no_keys_no_cli_no_tanzu` tests as-is — both still hold.)

- [ ] **Step 2: Run the tests to verify the reversed expectation fails**

Run: `uv run pytest packages/api/tests/voice/test_auto_select_provider.py -v`
Expected: `test_prefers_claude_cli_over_a_configured_api_key` **FAILS** (current code returns `"openai"`), the others pass.

- [ ] **Step 3: Reorder `_auto_select_provider` to prefer claude-cli**

In `packages/api/blogforge/api/voice.py`, replace the body of `_auto_select_provider` with:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest packages/api/tests/voice/test_auto_select_provider.py -v`
Expected: all 4 tests **PASS**.

- [ ] **Step 5: Run the broader voice/provider suite for regressions**

Run: `uv run pytest packages/api/tests/voice -q`
Expected: PASS (no other test depended on keys-beat-cli).

- [ ] **Step 6: Commit**

```bash
git add packages/api/blogforge/api/voice.py packages/api/tests/voice/test_auto_select_provider.py
git commit -m "feat(voice): prefer claude-cli over stored API keys in auto-select"
```

---

### Task 2: Frontend — claude-cli as the default compose provider

**Files:**
- Modify: `packages/web/src/lib/composeDefaults.ts` (`FALLBACK.provider`)
- Modify: `packages/web/src/components/SetupFields.tsx` (availability fallback order, ~line 156)
- Test: `packages/web/tests/lib/composeDefaults.test.ts` (update the fallback expectation)

**Interfaces:**
- Consumes: `/api/providers` availability map (`providers["claude-cli"]` is `true` when the binary is installed).
- Produces: `loadDefaults().provider === "claude-cli"` out of the box; `SetupFields` resolves to claude-cli first when available, else the first available provider.

- [ ] **Step 1: Update the composeDefaults test to expect the claude-cli default**

In `packages/web/tests/lib/composeDefaults.test.ts`, in the `"returns the fallback when nothing is stored"` test, change the expected `provider` from `"anthropic"` to `"claude-cli"`:

```ts
  it("returns the fallback when nothing is stored", () => {
    expect(loadDefaults()).toEqual({
      pack_slug: "",
      format: null,
      provider: "claude-cli",
      model: "",
      target_words: 1500,
      use_voice_profile: true,
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/web test -- composeDefaults`
Expected: the "returns the fallback" test **FAILS** (still `"anthropic"`).

- [ ] **Step 3: Change the fallback default provider**

In `packages/web/src/lib/composeDefaults.ts`, in the `FALLBACK` object, change:

```ts
  provider: "anthropic",
```
to:
```ts
  provider: "claude-cli",
```

- [ ] **Step 4: Reorder the SetupFields availability fallback so claude-cli is first**

In `packages/web/src/components/SetupFields.tsx` (~line 156), change:

```ts
      const order: Provider[] = ["anthropic", "openai", "google", "claude-cli", "tanzu"];
```
to:
```ts
      const order: Provider[] = ["claude-cli", "anthropic", "openai", "google", "tanzu"];
```

This keeps the graceful fallback: if `claude-cli` isn't available (binary not installed), the one-shot picks the first provider that *is* available.

- [ ] **Step 5: Run the frontend tests**

Run: `pnpm -C packages/web test -- composeDefaults SetupFields`
Expected: PASS. If `SetupFields.test.tsx` asserts a resolved provider that changes due to the new order, update that expectation to match "claude-cli when available."

- [ ] **Step 6: Typecheck + build (biome/tsc as configured)**

Run: `pnpm -C packages/web build`
Expected: builds clean (no TS errors from the edits).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/lib/composeDefaults.ts packages/web/src/components/SetupFields.tsx packages/web/tests/lib/composeDefaults.test.ts
git commit -m "feat(web): default new drafts to claude-cli when available"
```

---

### Task 3: Deploy to the live host + verify

**Files:**
- Modify (hardening): `scripts/serve-public.sh` (pin `~/.local/bin` ahead on PATH so the newer claude 2.1.205 is used)

**Interfaces:**
- Consumes: the merged code from Tasks 1-2; the `CLAUDE_CODE_OAUTH_TOKEN` already in `.env.public`.

- [ ] **Step 1: Pin the claude binary for the service (hardening)**

In `scripts/serve-public.sh`, immediately after the `cd "$(dirname "$0")/.."` line, add:

```bash
# Prefer the user-local claude (newer) over the Homebrew cask on the service PATH.
export PATH="$HOME/.local/bin:$PATH"
```

- [ ] **Step 2: Rebuild the web bundle (Task 2 changed frontend) + confirm venv**

Run from repo root (Intel host → no `arch` prefix):
```bash
export PATH="$HOME/.local/bin:$PATH"
APP_VERSION=$(node -p "require('./packages/web/package.json').version")
GIT_SHA=$(git rev-parse --short HEAD)
( cd packages/web && pnpm install --frozen-lockfile && \
  VITE_APP_VERSION="$APP_VERSION" VITE_GIT_SHA="$GIT_SHA" pnpm build )
rm -rf packages/api/blogforge/static && mkdir -p packages/api/blogforge/static
cp -R packages/web/dist/. packages/api/blogforge/static/
uv sync
```
Expected: bundle builds; `packages/api/blogforge/static/index.html` exists. (Backend change is Python — the editable venv picks it up on restart.)

- [ ] **Step 3: Restart the launchd agent**

Run: `launchctl kickstart -k gui/$(id -u)/com.baskettecase.blogforge`
Then: `curl --retry 30 --retry-delay 1 --retry-connrefused -fsS http://127.0.0.1:7880/api/health`
Expected: `{"status":"ok",...}`.

- [ ] **Step 4: Verify the service's claude uses the token + newer binary**

Run:
```bash
SVPID=$(lsof -tiTCP:7880 -sTCP:LISTEN | head -1)
ps eww -p "$SVPID" | tr ' ' '\n' | grep -q '^CLAUDE_CODE_OAUTH_TOKEN=' && echo "token in service env ✓"
```
Expected: `token in service env ✓`.

- [ ] **Step 5: End-to-end (manual, in the browser at https://blogforge.baskettecase.com)**

- New draft → the provider defaults to **Claude CLI**.
- Voice **distill** → succeeds via claude-cli (no Google call); Settings → Claude CLI card shows authenticated.
- **Hero image** on a draft → still generates (uses the Google key), unaffected.

Expected: all three behave as above.

- [ ] **Step 6: Commit the serve-script hardening**

```bash
git add scripts/serve-public.sh
git commit -m "chore(deploy): pin ~/.local/bin claude for the host service"
```

---

## Self-Review

**Spec coverage:** backend reorder (Task 1) ✓, frontend default (Task 2) ✓, hero unchanged (no task — verified in Task 3 Step 5) ✓, "available"=installed (Task 1 code) ✓, token prerequisite (Global Constraints — DONE) ✓, binary-pin hardening (Task 3) ✓, testing (Tasks 1-2 tests + Task 3 manual) ✓, explicit-choice rule (unchanged code paths; only defaults touched) ✓.

**Placeholder scan:** none — all code/tests/commands are literal.

**Type consistency:** `_auto_select_provider(user_id) -> str | None` consistent; `Provider` union and `ComposeSettings.provider` literal include `"claude-cli"`; patch target `blogforge.llm.claude_cli.claude_available` matches the in-function import.

## Verification Summary

| Task | Gate |
|---|---|
| 1 | 4/4 `test_auto_select_provider.py` pass; `tests/voice` green |
| 2 | `composeDefaults`/`SetupFields` tests pass; `pnpm build` clean |
| 3 | health 200; token in service env; new draft defaults to claude-cli; distill via claude-cli; hero still Google |
