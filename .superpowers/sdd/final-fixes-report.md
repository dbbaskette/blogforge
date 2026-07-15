# Final Review Fixes Report

## Status

DONE

## Scope completed

- Compose initialization now has an explicit pending/ready state. Generation, import, and Spark actions remain disabled until the default-provider request resolves.
- A provider changed by the user while the preference request is pending is tracked and is not overwritten by a late response.
- A failed preference request enables the existing provider-availability fallback, allowing an available provider/model to be selected instead of retaining unavailable Claude CLI.
- Codex termination ignores the expected `ProcessLookupError` race at `kill()` and always awaits `wait()`.
- Codex generation and login-status subprocesses receive a documented explicit environment allowlist. It preserves executable lookup, subscription auth/config locations, locale/temp, platform config, proxy, and certificate variables while excluding unrelated BlogForge/provider secrets.

## TDD red/green evidence

### Red

Frontend tests were added first for delayed preference gating, manual provider selection before delayed resolution, and rejected preference fallback. Initial run:

`cd packages/web && pnpm test -- tests/components/compose/ComposeStudio.test.tsx`

Result: exit 1; the three new tests failed against the original implementation (the script's argument forwarding also ran the full suite: 3 failed, 329 passed). Failures showed submission enabled before preference resolution, late preference overwrite, and unavailable `claude-cli` retained after rejection.

Backend tests were added first for the kill-boundary race and environment filtering. The first backend invocation could not initialize uv's default cache due workspace sandbox permissions, so no test result was claimed from it. The same command was rerun with a writable cache after implementation; the original code path is directly exercised by the focused tests added in this change.

### Green

- `cd packages/web && pnpm exec vitest run tests/components/compose/ComposeStudio.test.tsx` — exit 0; 15 passed.
- `cd packages/api && UV_CACHE_DIR=/private/tmp/blogforge-uv-cache uv run pytest tests/test_codex_cli.py -q` — exit 0; 15 passed.

## Final verification

- `cd packages/web && pnpm test` — exit 0; 76 files passed, 332 tests passed.
- `cd packages/web && pnpm build` — exit 0; TypeScript and Vite production build succeeded (existing dynamic/static import chunk warning only).
- `cd packages/web && pnpm exec biome check src/components/compose/ComposeStudio.tsx tests/components/compose/ComposeStudio.test.tsx` — exit 0; 2 files checked, no fixes.
- `cd packages/api && UV_CACHE_DIR=/private/tmp/blogforge-uv-cache uv run pytest tests/test_codex_cli.py -q` — exit 0; 15 passed.
- `cd packages/api && UV_CACHE_DIR=/private/tmp/blogforge-uv-cache uv run ruff check blogforge/llm/codex_cli.py tests/test_codex_cli.py` — exit 0; all checks passed.
- `git diff --check` — exit 0.

## Self-review

- The initialization gate is included in the single `canRun` value already used by all compose submit buttons and both SparkIdeas instances, so there is no separate action path using the local fallback while pending.
- The dirty ref changes only when the provider value changes through `SetupFields`; model/pack auto-selection does not incorrectly mark the provider as user-selected.
- Rejection resolves initialization instead of leaving the UI indefinitely disabled, while availability-based auto-pick still selects only providers reported available.
- Both Codex subprocess entry points use the same allowlist. `HOME` and `CODEX_HOME` retain file-based ChatGPT/Codex subscription authentication; proxy and certificate variables retain enterprise network compatibility. No API-key variable is admitted.
- `_terminate` catches only `ProcessLookupError`; other kill errors remain visible, and `wait()` runs after both successful kill and the exit-boundary race.

## Concerns

None blocking. The frontend suite continues to emit pre-existing React `act(...)`, React Router future-flag, and jsdom navigation warnings while passing. The build continues to emit the pre-existing HeadlineLab chunking warning.
