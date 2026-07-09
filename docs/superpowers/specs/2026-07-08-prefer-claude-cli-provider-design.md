# Prefer the Claude CLI provider when available (except hero image)

**Date:** 2026-07-08
**Status:** Approved design → ready for implementation plan

**Goal:** When the local Claude CLI (`claude -p`) is available, make it the **default / auto-selected** LLM provider for all text-generation features, so the user's Claude Max subscription is used by default instead of a pay-per-token API key. Hero **image** generation is unaffected (it must use Google Imagen).

## Context (current behavior)

- **Backend** `_auto_select_provider` (`packages/api/blogforge/api/voice.py:287`) tries vault API keys **first** — `anthropic → openai → google` — and falls back to `claude-cli` **last**. This is why voice distill grabbed a stored (invalid) Google key instead of the subscription.
- **Frontend** default provider is hardcoded `"anthropic"` (`packages/web/src/lib/composeDefaults.ts` `FALLBACK.provider`), and `SetupFields.tsx`'s availability one-shot fallback order lists `claude-cli` **near last** (`["anthropic","openai","google","claude-cli","tanzu"]`). A manual Settings toggle (`ClaudeCliCard`) can already make claude-cli the default — this change makes that the out-of-the-box behavior when available.
- **Draft routes** (outline, geo, claims, revise, suggest, repurpose, inline) use the provider **stored on the draft** (`draft.idea.provider`), set once at ideation. **Ideation** (`topics.py`) uses `body.provider` sent by the frontend. So the *default* only decides what new drafts get.
- **Hero image** (`api/hero.py`) is **hardcoded** to the Google key: `generate_hero_image(prompt, google_key)`. Only the optional *prompt text* uses the draft provider (with a safe fallback). The image step never uses the auto-selected provider → "except hero image" is already satisfied; **no change**.

## Definition of "available"

`available` = **installed** (`claude_available()` — the `claude` binary is on PATH), matching the rest of the codebase. It does **not** re-verify auth on every call (that needs a live `claude -p` probe, too slow for per-request selection).

## Prerequisite (blocks going live on the server)

A background/launchd service cannot use an interactive Max login — proven: clean-env `claude -p` returns "not logged in" for both installed claude binaries; no `.credentials.json` exists. The service authenticates via a **long-lived token**: `CLAUDE_CODE_OAUTH_TOKEN` in the gitignored `.env.public`, obtained from `claude setup-token`. `scripts/serve-public.sh` already **preserves** that variable through its `ANTHROPIC_*`/`CLAUDE_*` env scrub.

**Sequencing:** the code change is safe to write anytime, but it must not be deployed to the server until the token is set and clean-env `claude -p` is verified working — otherwise the server defaults to claude-cli and 401s. Because `available` = installed, the server (where `claude` is installed) *will* prefer claude-cli; the token is what makes that succeed.

## Changes

1. **Backend** — `_auto_select_provider` (`voice.py`): try **claude-cli first** when `claude_available()`, then vault keys (`anthropic → openai → google`), then `tanzu`. Return `None` only when nothing is usable. (~3 lines reordered.)
2. **Frontend default** — make claude-cli the effective compose default when available:
   - `composeDefaults.ts`: `FALLBACK.provider = "claude-cli"`.
   - `SetupFields.tsx`: reorder the availability fallback to `["claude-cli","anthropic","openai","google","tanzu"]`, and let the one-shot prefer claude-cli when it's available and the loaded provider isn't claude-cli. The existing `providerAutoPicked` guard keeps it from fighting a manual in-session pick.
3. **Hero image** — **unchanged** (stays on Google Imagen).
4. **Service binary consistency (hardening)** — the launchd service currently resolves `/usr/local/bin/claude` (Homebrew 2.1.86) via login-shell PATH, not `~/.local/bin/claude` (2.1.205). With a `CLAUDE_CODE_OAUTH_TOKEN` env var either binary authenticates, so this is non-blocking; note it and prefer pinning `~/.local/bin` ahead of `/usr/local/bin` in `serve-public.sh` for version consistency.

## Non-goals (YAGNI)

- No migration of existing drafts (they keep their stored provider).
- No re-verifying claude auth on every selection (relies on `available` = installed + the token).
- The invalid-key → opaque 500 fix (distill route swallows `ProviderError`) is a **separate** improvement, tracked apart from this change.

## Testing

- **Backend unit** (`packages/api/tests`): `_auto_select_provider` returns `"claude-cli"` when `claude_available()` is True regardless of stored vault keys; returns the first vault key when claude is not installed; returns `tanzu`/`None` appropriately. Patch `claude_available` and `KeyVault.get`.
- **Frontend unit** (`packages/web/tests`): with `providers["claude-cli"] === true`, the resolved default provider is `claude-cli`; with it false and an anthropic key present, resolves to `anthropic`; a manual pick is not overridden.
- **Manual (server, after token):** a new draft and a voice distill both route through claude-cli; hero image still generates via Google.

## Explicit-choice rule

An explicit provider selection always wins: the change only affects the *default/auto-selected* provider, never a provider the user (or an existing draft) has explicitly set.
