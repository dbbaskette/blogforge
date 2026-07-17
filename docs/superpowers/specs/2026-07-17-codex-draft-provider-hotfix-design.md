# Codex Draft Provider Hotfix Design

## Problem

BlogForge exposes `codex-cli` in Settings and the draft Setup UI, and its live status probe can report the CLI as installed and authenticated. The persisted draft schemas do not include `codex-cli`, however. A draft therefore cannot be created, imported, or updated with Codex as its provider. Changing the user's default provider only affects new compose sessions and does not migrate an existing draft, so analysis tools such as Humanize continue calling that draft's old provider and can return HTTP 502.

## Scope

- Add `codex-cli` to every API schema that accepts a text provider for draft creation, import, persistence, and related compose requests.
- Keep the user-level default provider and each draft's stored provider separate. Do not silently migrate existing drafts.
- Continue using `codex-default` as the only Codex CLI model.
- Verify an existing draft can be changed through Setup to `codex-cli` and subsequently resolved through `CodexCliProvider` by Humanize and the other draft tools.
- Preserve all existing providers and validation behavior.

The admin log viewer and general punctuation checking are separate follow-up features and are not part of this production hotfix.

## API and Data Flow

Provider literals used by draft-facing request and persistence models will share support for `codex-cli`. The web client already includes Codex in its `Provider` type and Setup selector. On save, the full draft update will validate and persist `idea.provider = "codex-cli"` with `idea.model = "codex-default"`. Later analysis routes read those stored fields and `build_provider_for` resolves the Codex CLI provider without an API key.

No database migration is required because the provider is stored as text inside the existing draft data model.

## Error Handling

Invalid provider names remain rejected by Pydantic. Codex installation, authentication, timeout, quota, and execution failures continue through the existing typed `ProviderError` to HTTP 502 mapping. This hotfix removes the schema mismatch; it does not hide genuine provider failures.

## Testing

- Model test: `IdeaInput` accepts `codex-cli` and `codex-default`.
- API tests: create, import, and update retain the Codex provider/model.
- Provider-resolution or Humanize route test: a Codex-backed draft resolves `CodexCliProvider` rather than an API-key provider.
- Existing provider and Codex CLI test suites remain green.

## Release

Ship through a focused pull request, merge to `main`, redeploy with `scripts/deploy-home.sh`, and verify internal and public health. After deployment, the affected existing draft must be switched explicitly in its Setup panel to Codex CLI.
