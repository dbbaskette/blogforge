# Codex CLI Provider and User Default Writing Provider

**Date:** 2026-07-15

## Goal

Add the locally authenticated Codex CLI as a keyless, subscription-backed writing provider without replacing the existing Claude CLI provider. Let each user choose one default writing provider in Settings, and use that preference consistently for new drafts and model-powered work that is not attached to a draft.

## Product decisions

- `codex-cli` and `claude-cli` remain separate first-class providers.
- The user chooses one default writing provider in Settings.
- The preference is stored per user on the server, not only in browser local storage.
- Codex uses the model configured as the Codex CLI default. BlogForge does not pass `--model`.
- Codex may perform unrestricted web search and fetch author-specified sources, matching the research behavior expected from the Claude CLI provider.
- Existing drafts retain their current provider.
- If the selected provider is unavailable, BlogForge reports an actionable error and does not silently fall back to another provider.

## Architecture

### Codex provider

Add `CodexCliProvider`, implementing the existing `LLMProvider` interface and registered under `codex-cli`. It runs the locally installed `codex` binary non-interactively with `codex exec`, passes the BlogForge prompt on standard input, and uses an ephemeral Codex session.

Every generation runs in a newly created temporary working directory so Codex cannot inherit BlogForge repository instructions or use the repository as writing context. The command uses a read-only sandbox and explicitly permits execution outside a Git repository. Network-backed web search remains enabled through Codex configuration so the agent can research the topic and retrieve author-provided URLs. BlogForge does not provide the repository as an additional writable directory and does not bypass approvals or sandboxing.

BlogForge supplies a content-engine directive that requires only the requested article or structured response, with no planning commentary, acknowledgements, or process notes. For ordinary completion, the provider captures Codex's final assistant message separately from execution events. For structured completion, BlogForge appends the requested JSON schema and applies the same best-effort JSON extraction behavior used by the Claude CLI provider.

The provider uses the Codex CLI's configured default model by omitting `--model`. The model picker displays a single synthetic choice, `Codex default`, rather than copying model identifiers into BlogForge. The provider reports no dollar cost. Token usage is recorded only when the installed CLI exposes it reliably.

### Status and availability

Provider availability means the `codex` binary is on the API process's `PATH`. A live status endpoint reports installation and authentication separately. Each user-triggered refresh runs `codex login status`, followed by a small bounded generation probe in a temporary directory when login status succeeds. This proves end-to-end usability without adding a probe to normal provider selection or every generation request.

Status results distinguish:

- CLI missing;
- CLI installed but not authenticated;
- probe timeout;
- subscription or usage limit;
- command execution or malformed-output failure; and
- installed, authenticated, and usable.

Messages include a concrete recovery step, such as logging in from the same host account that runs BlogForge. Like Claude CLI, Codex CLI is only available when BlogForge runs on a host with the binary and its authentication state. Container and cloud deployments do not advertise it unless they intentionally provide both.

## Default provider preference

Add a nullable `default_provider` field to the user record through an Alembic migration. Accepted values are the same provider identifiers BlogForge exposes for text generation, including `codex-cli`, `claude-cli`, `tanzu`, and the API-key providers. The API validates the value before persistence.

Settings replaces the Claude-specific default checkbox with one mutually exclusive `Default writing provider` control. It shows Codex CLI and Claude CLI live status, configured API-key providers, and Tanzu availability. Unavailable choices are visible but disabled with an explanation. Saving the selection updates the server preference.

The selected default governs:

1. the initial provider for newly composed drafts; and
2. automatic model work without a draft-owned provider, including voice distillation, audition, fingerprint scoring, and equivalent voice operations.

Existing drafts remain bound to their selected provider. Changing the default never migrates them.

The existing browser-local compose defaults continue to store format, target length, voice usage, and the last compatible model choice. Provider ownership moves to the server. Client code must ignore or migrate the old local `provider` value so a stale browser setting cannot override the user's server preference.

For users whose `default_provider` is null, preserve the existing automatic-selection behavior for backward compatibility. The first explicit Settings choice becomes authoritative. Once authoritative, an unavailable provider causes a clear failure rather than automatic paid or cross-provider fallback.

## Data flow

### New draft

1. The compose screen loads provider availability and the authenticated user's default preference.
2. The form initializes its provider from the server preference, or from legacy automatic selection when the preference is null.
3. The user may still choose a different provider for that draft.
4. The chosen provider is saved with the draft and governs all later draft-specific generation.

### Automatic voice operation

1. The API reads the user's `default_provider`.
2. If null, it runs the legacy automatic-selection rule.
3. If set, it verifies that provider's required key, binding, binary, or CLI availability.
4. It invokes that provider or returns an actionable provider-unavailable error. It does not fall through to a different provider.

### Codex generation

1. BlogForge composes the complete prompt, including attached reference content and URLs.
2. `CodexCliProvider` creates a temporary working directory and invokes an ephemeral, read-only `codex exec` process without a model override.
3. Codex may search the web and fetch sources while producing the response.
4. BlogForge reads the final assistant message, normalizes structured JSON when requested, and returns an `LLMResponse`.
5. The process and temporary directory are cleaned up on success, error, timeout, or cancellation.

## Error handling

- Apply a bounded generation timeout consistent with the Claude CLI provider.
- Kill and reap timed-out or cancelled child processes before removing temporary files.
- Prefer specific CLI diagnostics over generic exit-code messages, while truncating output included in API errors.
- Never include login tokens, environment secrets, complete prompts, or complete generated drafts in error messages.
- Treat missing final output, malformed CLI events, authentication failure, and usage limits as provider errors with actionable hints.
- Do not retry through a different provider.

## UI changes

- Add a Codex CLI subscription card with live installation/login status and refresh action.
- Replace the standalone Claude default checkbox with one default-provider selector shared across all providers.
- Label the Codex model as `Codex default`; do not expose a stale hard-coded model list.
- Add `Codex CLI` anywhere provider labels or TypeScript provider unions are enumerated.
- Explain that CLI providers use the host's subscription login and are unavailable in ordinary cloud/container deployments.

No broader visual redesign is included.

## Testing

### Backend

- command construction uses `codex exec`, an ephemeral session, a read-only sandbox, execution outside a Git repository, and no `--model`;
- generation uses a temporary working directory and permits configured web research;
- final assistant output is separated from JSONL/event output;
- structured JSON coercion works;
- process timeout, cancellation, authentication, usage-limit, and malformed-output errors are mapped correctly;
- status distinguishes missing, unauthenticated, authenticated, timeout, and failed states;
- provider registry, availability, model listing, and status endpoints include `codex-cli`;
- user default preference validation and persistence work;
- new drafts initialize from the user preference without changing existing drafts;
- automatic voice work honors an explicit preference and preserves legacy selection only when it is null;
- an unavailable explicit preference fails without fallback; and
- database migration upgrade behavior is covered.

### Frontend

- Codex status card renders each state and refreshes;
- the default-provider control is mutually exclusive and persists through the API;
- unavailable providers are disabled with helpful text;
- compose initialization uses the server preference and does not allow stale local provider data to win;
- `Codex default` appears as the only Codex model choice; and
- existing draft provider selection remains unchanged.

### Regression

Existing Claude CLI, API-key provider, Tanzu, generation, and voice tests continue to pass. Claude CLI behavior changes only in the Settings control used to select it as the default.

## Documentation and deployment

Update the README and host-run documentation to describe Codex CLI as an additional subscription-backed option. Document that BlogForge must run under the same host account where `codex login status` succeeds and that Codex CLI uses its configured default model. Cloud/Tanzu guidance must state that neither local CLI provider is available unless deliberately installed and authenticated in that environment.

## Out of scope

- Replacing or removing Claude CLI.
- Refactoring both CLI providers into a generic subprocess framework.
- Selecting or pinning a Codex model inside BlogForge.
- Changing existing drafts to Codex.
- Falling back automatically from an unavailable chosen provider.
- Enabling Codex to edit BlogForge or any other repository during writing generation.
