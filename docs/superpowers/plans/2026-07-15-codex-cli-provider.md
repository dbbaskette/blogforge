# Codex CLI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codex CLI as a subscription-backed writing provider and let each user choose one server-side default provider for new drafts and automatic voice work.

**Architecture:** Implement a focused `CodexCliProvider` beside the existing Claude adapter, then expose it through the existing registry and provider APIs. Store a nullable validated default on `User`; Settings owns that preference, while compose and provider-less voice operations consume it without changing existing drafts.

**Tech Stack:** Python 3.11, FastAPI, Pydantic 2, SQLAlchemy 2/Alembic, asyncio subprocesses, React 18, TypeScript, Vitest/Testing Library, pytest.

## Global Constraints

- `codex-cli` and `claude-cli` remain separate first-class providers.
- Codex uses the CLI-configured default model; never pass `--model`.
- Run Codex ephemerally in a temporary non-repository directory with a read-only sandbox and web search enabled.
- Never bypass Codex approvals or sandboxing and never expose the BlogForge repository as writable context.
- An explicit unavailable default provider fails clearly; it never falls through to another provider.
- Existing drafts retain their provider.
- Do not refactor the two CLI providers into a generic subprocess framework.

---

## File map

- `packages/api/blogforge/llm/codex_cli.py`: Codex command construction, execution, output parsing, status, and `LLMProvider` adapter.
- `packages/api/blogforge/llm/registry.py`, `rates.yaml`, `keys/vault.py`: provider registration, synthetic model, and keyless availability sentinel.
- `packages/api/blogforge/api/providers.py`: availability, model-list, status, and default-preference endpoints.
- `packages/api/blogforge/db/models.py`, `alembic/versions/0017_user_default_provider.py`: persisted user preference.
- `packages/api/blogforge/api/voice.py`: preference-aware provider selection for provider-less voice jobs.
- `packages/web/src/api/providers.ts`: shared provider/status/default API types.
- `packages/web/src/components/settings/CodexCliCard.tsx`: Codex live status.
- `packages/web/src/components/settings/DefaultProviderCard.tsx`: mutually exclusive server-side preference selector.
- `packages/web/src/components/settings/ClaudeCliCard.tsx`: status only; remove browser-local default toggle.
- `packages/web/src/lib/composeDefaults.ts`, `components/SetupFields.tsx`, `components/compose/ComposeStudio.tsx`: add provider union and initialize new compose sessions from the server preference.
- `README.md`: user and deployment guidance.

### Task 1: Codex CLI adapter

**Files:**
- Create: `packages/api/blogforge/llm/codex_cli.py`
- Create: `packages/api/tests/test_codex_cli.py`

**Interfaces:**
- Produces: `codex_available() -> bool`
- Produces: `codex_status(timeout: float = 20.0) -> Awaitable[dict[str, object]]`
- Produces: `CodexCliProvider(api_key: str = "")` implementing `LLMProvider`
- Produces: one synthetic model with ID `codex-default` and label `Codex default`

- [ ] **Step 1: Write failing availability, model, and command tests**

Create tests that monkeypatch `shutil.which` and `asyncio.create_subprocess_exec`. The command assertion must require these arguments and prohibit a model override:

```python
assert args[:2] == ("/usr/bin/codex", "exec")
assert "--ephemeral" in args
assert ("--sandbox", "read-only") == (args[args.index("--sandbox")], args[args.index("--sandbox") + 1])
assert "--skip-git-repo-check" in args
assert "--model" not in args
assert "-" == args[-1]
assert kwargs["cwd"].startswith(tempfile.gettempdir())
```

Cover `codex_available()`, `list_models()`, final-message extraction, JSON coercion, nonzero exit, missing output, and timeout. Simulate `codex exec` writing `"Finished article"` to the path passed after `--output-last-message`; keep stdout JSONL noisy to prove it is not returned as content.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
uv run pytest packages/api/tests/test_codex_cli.py -v
```

Expected: collection fails with `ModuleNotFoundError: blogforge.llm.codex_cli`.

- [ ] **Step 3: Implement the provider**

Create `codex_cli.py` with constants and helpers:

```python
_TIMEOUT_SECONDS = 600
_MODEL_ID = "codex-default"
_ENGINE_DIRECTIVE = (
    "You are a content-generation engine embedded inside an application. "
    "Research the web whenever useful, including retrieving URLs named in the prompt. "
    "Output ONLY the requested content. Never add preamble, acknowledgements, "
    "planning, process notes, or commentary."
)

def codex_available() -> bool:
    return shutil.which("codex") is not None
```

Build the command exactly as follows, writing the final message to a file inside the temporary directory:

```python
args = [
    self._bin,
    "exec",
    "--ephemeral",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--output-last-message", output_path,
    "-c", 'web_search="live"',
    "-",
]
```

Pass `f"{_ENGINE_DIRECTIVE}\n\n{prompt}"` on stdin. Use `tempfile.TemporaryDirectory(prefix="blogforge-codex-")`, `asyncio.wait_for`, and `create_subprocess_exec` with piped stdin/stdout/stderr. On timeout, kill and `await proc.wait()` before raising `ProviderError("codex exec timed out.")`. On cancellation, kill, reap, and re-raise. On nonzero exit, prefer stderr, then stdout, truncate to 600 characters, and include a `codex login status` hint. Read only `output_path` for successful content.

`complete()` appends the supplied JSON schema exactly as the Claude adapter does, calls `_coerce_json` for structured output, and returns `model=_MODEL_ID`. `stream()` emits one content chunk and one usage chunk. The synthetic `ModelInfo` has `supports_streaming=False`, no prices, and a conservative `context_window=200_000`.

- [ ] **Step 4: Add status tests and implementation**

Test and implement these results:

```python
{"installed": False, "authenticated": False, ...}
{"installed": True, "authenticated": False, ...}
{"installed": True, "authenticated": True, ...}
```

`codex_status()` first executes `codex login status`. When it succeeds, call the provider with `"Reply with the single word OK."` under the shorter status timeout. Map authentication text, rate/usage-limit text, timeout, and `OSError` to actionable `detail` and `resolve` strings; never raise from the status function.

- [ ] **Step 5: Run focused tests**

Run:

```bash
uv run pytest packages/api/tests/test_codex_cli.py -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/api/blogforge/llm/codex_cli.py packages/api/tests/test_codex_cli.py
git commit -m "feat(llm): add Codex CLI provider"
```

### Task 2: Provider registry and provider APIs

**Files:**
- Modify: `packages/api/blogforge/llm/registry.py`
- Modify: `packages/api/blogforge/llm/rates.yaml`
- Modify: `packages/api/blogforge/keys/vault.py`
- Modify: `packages/api/blogforge/api/providers.py`
- Modify: `packages/api/tests/test_key_vault.py`
- Create: `packages/api/tests/test_codex_providers_api.py`

**Interfaces:**
- Consumes: `CodexCliProvider`, `codex_available`, and `codex_status` from Task 1.
- Produces: `GET /api/providers` key `codex-cli`.
- Produces: `GET /api/providers/codex-cli/status`.
- Produces: `GET /api/providers/codex-cli/models` returning `codex-default`.

- [ ] **Step 1: Write failing registry, vault, and API tests**

Add assertions that:

```python
assert isinstance(get_provider("codex-cli", ""), CodexCliProvider)
assert await KeyVault(user_id).get("codex-cli") == "cli"
assert response.json()["codex-cli"] is True
assert model_response.json()[0]["id"] == "codex-default"
```

Monkeypatch the provider module at its definition site. Verify the static status route wins over `/{provider}/models` and returns the exact mocked status payload.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
uv run pytest packages/api/tests/test_key_vault.py packages/api/tests/test_codex_providers_api.py -v
```

Expected: failures because `codex-cli` is not registered or exposed.

- [ ] **Step 3: Register the provider and keyless sentinel**

Import `CodexCliProvider` in `registry.py` and add:

```python
"codex-cli": lambda api_key: CodexCliProvider(api_key=api_key),
```

In `KeyVault.get`, handle both keyless CLIs before `_check_provider`:

```python
if provider == "claude-cli":
    from blogforge.llm.claude_cli import claude_available
    return "cli" if claude_available() else ""
if provider == "codex-cli":
    from blogforge.llm.codex_cli import codex_available
    return "cli" if codex_available() else ""
```

Add a `codex-cli` rate entry containing only `codex-default`, label `Codex default`, null-equivalent zero subscription prices, `context_window: 200000`, and `supports_streaming: false`.

- [ ] **Step 4: Add availability, status, and model routing**

In `list_providers`, add `out["codex-cli"] = codex_available()`. Add the static status route before `/{provider}/models`:

```python
@router.get("/codex-cli/status")
async def codex_cli_status(current: User = Depends(get_current_user)) -> dict[str, object]:
    from blogforge.llm.codex_cli import codex_status
    return await codex_status()
```

Change the model-list keyless branch to accept both CLI provider names and resolve through `get_provider(provider, "")`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
uv run pytest packages/api/tests/test_key_vault.py packages/api/tests/test_codex_providers_api.py packages/api/tests/test_claude_cli.py packages/api/tests/test_claude_status.py -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/api/blogforge/llm/registry.py packages/api/blogforge/llm/rates.yaml packages/api/blogforge/keys/vault.py packages/api/blogforge/api/providers.py packages/api/tests/test_key_vault.py packages/api/tests/test_codex_providers_api.py
git commit -m "feat(api): expose Codex CLI provider"
```

### Task 3: Persist and expose the user's default provider

**Files:**
- Modify: `packages/api/blogforge/db/models.py`
- Create: `packages/api/alembic/versions/0017_user_default_provider.py`
- Modify: `packages/api/blogforge/api/providers.py`
- Create: `packages/api/tests/test_default_provider.py`
- Modify: `packages/api/tests/test_db_models.py`

**Interfaces:**
- Produces: `User.default_provider: str | None`.
- Produces: `DefaultProviderResponse(default_provider: str | None)`.
- Produces: `GET /api/providers/default` and `PUT /api/providers/default` with body `{"default_provider": string}`.
- Produces: `TEXT_PROVIDERS`, the shared validated provider-name tuple in `api/providers.py`.

- [ ] **Step 1: Write failing model and endpoint tests**

Test a nullable default on a newly created user, valid persistence for all six values, rejection of `"bogus"` with HTTP 422, and isolation between two users. The accepted tuple is:

```python
TEXT_PROVIDERS = (
    "anthropic", "openai", "google", "claude-cli", "codex-cli", "tanzu"
)
```

Also test that the PUT endpoint accepts an unavailable provider: preference persistence is separate from runtime availability, allowing the user to repair login or configuration later.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
uv run pytest packages/api/tests/test_default_provider.py packages/api/tests/test_db_models.py -v
```

Expected: failures because the column and endpoints do not exist.

- [ ] **Step 3: Add model and migration**

Add to `User`:

```python
default_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
```

Create Alembic revision `0017_user_default_provider`, `down_revision = "0016_user_provider_keys"`, whose upgrade adds `users.default_provider VARCHAR(32) NULL` and whose downgrade drops it. Follow the dialect-neutral style of the preceding migrations.

- [ ] **Step 4: Add preference API**

In `api/providers.py`, add:

```python
class DefaultProviderBody(BaseModel):
    default_provider: Literal[
        "anthropic", "openai", "google", "claude-cli", "codex-cli", "tanzu"
    ]

class DefaultProviderResponse(BaseModel):
    default_provider: str | None
```

`GET /default` returns `current.default_provider`. `PUT /default` loads the user in the injected `AsyncSession`, assigns the validated value, commits, and returns it. Declare both static routes before `/{provider}/models`.

- [ ] **Step 5: Run focused tests and migration check**

Run:

```bash
uv run pytest packages/api/tests/test_default_provider.py packages/api/tests/test_db_models.py -v
uv run alembic -c packages/api/alembic.ini upgrade head
```

Expected: tests pass; Alembic reaches revision `0017_user_default_provider`.

- [ ] **Step 6: Commit**

```bash
git add packages/api/blogforge/db/models.py packages/api/alembic/versions/0017_user_default_provider.py packages/api/blogforge/api/providers.py packages/api/tests/test_default_provider.py packages/api/tests/test_db_models.py
git commit -m "feat(settings): persist default writing provider"
```

### Task 4: Use the preference for provider-less voice work

**Files:**
- Modify: `packages/api/blogforge/api/voice.py`
- Modify: `packages/api/tests/voice/test_auto_select_provider.py`
- Modify: `packages/api/tests/api/test_voice_route.py`

**Interfaces:**
- Consumes: `User.default_provider` and provider names from Task 3.
- Changes: `_auto_select_provider(user_id) -> str | None` returns an explicit preference before legacy selection.
- Changes: `_default_model("codex-cli") -> "codex-default"`.

- [ ] **Step 1: Write failing preference-selection tests**

Add tests for:

```python
assert await _auto_select_provider(user_with_codex_default.id) == "codex-cli"
assert await _auto_select_provider(user_with_openai_default.id) == "openai"
```

For an explicit unavailable default, assert it still returns that name so `build_provider_for` produces the actionable provider-unavailable error instead of fallback. Retain and run existing null-preference tests proving the legacy order remains Claude CLI, API keys, Tanzu, then none.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
uv run pytest packages/api/tests/voice/test_auto_select_provider.py -v
```

Expected: explicit preferences are ignored by the current function.

- [ ] **Step 3: Implement preference-first selection**

At the beginning of `_auto_select_provider`, load only the user's preference:

```python
async with get_sessionmaker()() as session:
    preferred = await session.scalar(select(User.default_provider).where(User.id == user_id))
if preferred:
    return preferred
```

Leave the current Claude/API-key/Tanzu legacy selection below it unchanged. Add `"codex-cli": "codex-default"` to `_PROVIDER_DEFAULTS`. Ensure missing-key error copy mentions CLI subscription providers as well as API keys.

- [ ] **Step 4: Run focused voice tests**

Run:

```bash
uv run pytest packages/api/tests/voice/test_auto_select_provider.py packages/api/tests/api/test_voice_route.py -v
```

Expected: all tests pass, including legacy null behavior.

- [ ] **Step 5: Commit**

```bash
git add packages/api/blogforge/api/voice.py packages/api/tests/voice/test_auto_select_provider.py packages/api/tests/api/test_voice_route.py
git commit -m "feat(voice): honor user default provider"
```

### Task 5: Add Codex status UI and the shared default selector

**Files:**
- Modify: `packages/web/src/api/providers.ts`
- Create: `packages/web/src/components/settings/CodexCliCard.tsx`
- Create: `packages/web/src/components/settings/DefaultProviderCard.tsx`
- Modify: `packages/web/src/components/settings/ClaudeCliCard.tsx`
- Modify: `packages/web/src/routes/SettingsPage.tsx`
- Create: `packages/web/tests/components/CodexCliCard.test.tsx`
- Create: `packages/web/tests/components/DefaultProviderCard.test.tsx`
- Modify: `packages/web/tests/components/ClaudeCliCard.test.tsx`

**Interfaces:**
- Produces: `Provider` union including `codex-cli`.
- Produces: `getCodexCliStatus()`, `getDefaultProvider()`, and `setDefaultProvider(provider)`.
- Consumes: provider availability API from Task 2 and preference API from Task 3.

- [ ] **Step 1: Write failing component and API tests**

Test Codex statuses `Checking`, authenticated, unauthenticated, and missing. Test that the default selector:

- loads the server value;
- shows all six providers;
- marks exactly one radio option checked;
- disables unavailable choices with explanatory text;
- saves `{"default_provider":"codex-cli"}`; and
- does not mutate `bf.compose.defaults`.

Update Claude card tests to assert it contains status/refresh but no default checkbox.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd packages/web && pnpm test -- CodexCliCard DefaultProviderCard ClaudeCliCard
```

Expected: new modules are missing and the Claude checkbox assertion fails.

- [ ] **Step 3: Add provider API types and calls**

Define:

```typescript
export type Provider = "anthropic" | "openai" | "google" | "claude-cli" | "codex-cli" | "tanzu";
export interface CliStatus {
  installed: boolean;
  authenticated: boolean;
  detail: string;
  resolve: string;
}
export const getCodexCliStatus = (): Promise<CliStatus> =>
  api("/api/providers/codex-cli/status");
export const getDefaultProvider = (): Promise<{ default_provider: Provider | null }> =>
  api("/api/providers/default");
export const setDefaultProvider = (default_provider: Provider) =>
  api<{ default_provider: Provider }>("/api/providers/default", {
    method: "PUT",
    body: JSON.stringify({ default_provider }),
  });
```

Alias the existing `ClaudeCliStatus` to `CliStatus` to avoid unnecessary downstream churn.

- [ ] **Step 4: Build the two Settings components**

Build `CodexCliCard` from the status-only structure of `ClaudeCliCard`, with heading `Codex CLI (subscription)`, binary name `codex`, and recovery guidance supplied by the API. Remove `loadDefaults`, `saveDefaults`, state, handler, and checkbox from `ClaudeCliCard`.

Build `DefaultProviderCard` with radio inputs and labels:

```typescript
const LABELS: Record<Provider, string> = {
  "codex-cli": "Codex CLI (subscription)",
  "claude-cli": "Claude CLI (subscription)",
  anthropic: "Anthropic API",
  openai: "OpenAI API",
  google: "Google API",
  tanzu: "Tanzu bound model",
};
```

Fetch preference and availability together, save immediately on radio change, restore the prior selection on failure, and show an inline error. Disabled options remain visible. Render `DefaultProviderCard`, `CodexCliCard`, and `ClaudeCliCard` in Settings before API keys.

- [ ] **Step 5: Run focused tests and lint**

Run:

```bash
cd packages/web && pnpm test -- CodexCliCard DefaultProviderCard ClaudeCliCard
cd packages/web && pnpm lint
```

Expected: tests and Biome pass.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/api/providers.ts packages/web/src/components/settings/CodexCliCard.tsx packages/web/src/components/settings/DefaultProviderCard.tsx packages/web/src/components/settings/ClaudeCliCard.tsx packages/web/src/routes/SettingsPage.tsx packages/web/tests/components/CodexCliCard.test.tsx packages/web/tests/components/DefaultProviderCard.test.tsx packages/web/tests/components/ClaudeCliCard.test.tsx
git commit -m "feat(settings): choose default writing provider"
```

### Task 6: Initialize new drafts from the server preference

**Files:**
- Modify: `packages/web/src/lib/composeDefaults.ts`
- Modify: `packages/web/src/components/SetupFields.tsx`
- Modify: `packages/web/src/components/compose/ComposeStudio.tsx`
- Modify: `packages/web/src/components/compose/SparkIdeas.tsx`
- Modify: `packages/web/src/components/compose/SetupSummary.tsx`
- Modify: `packages/web/src/components/draft/SetupDisclosure.tsx`
- Modify: `packages/web/tests/lib/composeDefaults.test.ts`
- Modify: `packages/web/tests/components/SetupFields.test.tsx`
- Create: `packages/web/tests/components/ComposeStudio.test.tsx`

**Interfaces:**
- Consumes: `Provider` and `getDefaultProvider()` from Task 5.
- Changes: browser-local defaults no longer persist provider ownership.
- Preserves: per-draft provider selection and saved draft provider.

- [ ] **Step 1: Write failing migration and initialization tests**

Seed local storage with a stale payload containing `provider: "claude-cli"`, mock the server preference as `codex-cli`, and assert the compose form selects Codex. Assert `saveDefaults()` does not write a provider field. Test that a null server preference retains the legacy availability auto-pick. Test that changing provider within a draft form remains possible and is sent with the draft payload.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd packages/web && pnpm test -- composeDefaults SetupFields ComposeStudio
```

Expected: stale local provider overrides the server or `codex-cli` is absent from unions/options.

- [ ] **Step 3: Separate persisted compose defaults from runtime settings**

Use the shared `Provider` type. Keep `ComposeSettings.provider` because draft creation needs it, but define the persisted shape without it:

```typescript
type PersistedComposeDefaults = Omit<ComposeSettings, "provider">;
```

`loadDefaults()` returns format/pack/model/length/voice defaults plus a temporary legacy fallback provider used only until the server request resolves. `saveDefaults()` destructures and discards provider before serializing:

```typescript
export function saveDefaults({ provider: _provider, ...persisted }: ComposeSettings): void {
  localStorage.setItem(KEY, JSON.stringify(persisted));
}
```

- [ ] **Step 4: Apply the server preference once per new compose session**

In `ComposeStudio`, fetch `getDefaultProvider()` on mount. When it returns a non-null value, update only `provider` and clear `model` so `SetupFields` loads the synthetic `Codex default` or the chosen provider's valid models. Do not apply this effect inside `SetupDisclosure`, which edits an existing draft. Extend labels, availability order, select options, and error copy to include `codex-cli`; use `Codex CLI (subscription)` and `not installed` copy.

- [ ] **Step 5: Run focused tests, full web tests, and build**

Run:

```bash
cd packages/web && pnpm test -- composeDefaults SetupFields ComposeStudio
cd packages/web && pnpm test
cd packages/web && pnpm build
```

Expected: all tests pass and TypeScript/Vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/composeDefaults.ts packages/web/src/components/SetupFields.tsx packages/web/src/components/compose/ComposeStudio.tsx packages/web/src/components/compose/SparkIdeas.tsx packages/web/src/components/compose/SetupSummary.tsx packages/web/src/components/draft/SetupDisclosure.tsx packages/web/tests/lib/composeDefaults.test.ts packages/web/tests/components/SetupFields.test.tsx packages/web/tests/components/ComposeStudio.test.tsx
git commit -m "feat(compose): use server default provider"
```

### Task 7: Documentation and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `scripts/serve-host.sh` only if its environment scrub prevents Codex authentication
- Modify: `scripts/serve-public.sh` only if its environment scrub prevents Codex authentication
- Modify: `packages/api/tests/test_cli.py` only if host-run script expectations change

**Interfaces:**
- Consumes: complete backend and frontend behavior from Tasks 1–6.
- Produces: documented local setup and verified release candidate.

- [ ] **Step 1: Update documentation**

Add Codex CLI beside Claude CLI in provider, simplest-local-run, host-run, and cloud/Tanzu sections. Include these exact operational facts:

```text
Run `codex login status` as the same host account that runs BlogForge.
BlogForge invokes `codex exec` ephemerally and uses the model configured as the Codex CLI default.
Codex CLI generation can search and fetch the web.
Local CLI providers are unavailable in ordinary cloud/container deployments unless deliberately installed and authenticated there.
```

If script inspection shows no Codex environment variables are scrubbed, do not modify the scripts.

- [ ] **Step 2: Run backend static checks and full tests**

Run:

```bash
uv run ruff check packages/api/blogforge packages/api/tests
uv run mypy packages/api/blogforge
uv run pytest
```

Expected: all commands exit 0.

- [ ] **Step 3: Run frontend verification**

Run:

```bash
cd packages/web && pnpm lint
cd packages/web && pnpm test
cd packages/web && pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 4: Run live CLI smoke checks on the host**

Run:

```bash
codex login status
printf 'Reply with the single word OK.' | codex exec --ephemeral --sandbox read-only --skip-git-repo-check -C /tmp -
```

Expected: login status succeeds and the final response is `OK`. Then start BlogForge through the normal host script, open Settings, refresh both CLI cards, select Codex CLI as default, create a new draft, confirm `Codex default`, attach a URL, and generate. Verify the result uses the source and that an older draft still retains its original provider.

- [ ] **Step 5: Review the final diff for scope and secrets**

Run:

```bash
git diff --check
git status --short
git diff --stat
rg -n "OPENAI_API_KEY|CODEX_ACCESS_TOKEN|access_token|refresh_token" packages README.md scripts
```

Expected: no whitespace errors, only planned files changed, and no credential values appear.

- [ ] **Step 6: Commit documentation or verification fixes**

```bash
git add README.md scripts/serve-host.sh scripts/serve-public.sh packages/api/tests/test_cli.py
git commit -m "docs: document Codex CLI provider"
```

Skip unchanged paths in `git add`. If verification required code fixes, rerun the exact failing command and commit those fixes with a scoped `fix:` message before this documentation commit.

## Completion criteria

- Codex CLI and Claude CLI are independently visible and usable.
- Codex runs with web research, no model override, no repository context, and no write-capable sandbox.
- A per-user default controls new drafts and provider-less voice work.
- Existing drafts remain unchanged.
- Explicit unavailable defaults fail without cross-provider fallback.
- Backend tests/static checks and frontend tests/lint/build pass.
- README and deployment guidance describe the host-authentication requirement.
