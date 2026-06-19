# Per-User API Keys — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design), pending implementation plan.
**Scope:** Move LLM provider API keys from a single admin-managed global store to **per-user** keys entered in Settings. Each user's generation uses their own key. First of two sub-projects (this, then **Bound Tanzu models**, which extends the resolution seam introduced here).

## Goal
- Each signed-in user stores their own Anthropic / OpenAI / Google keys in **Settings → Provider API keys**; generation uses the current user's key.
- A single resolution helper `build_provider_for(user_id, provider)` replaces the ~13 inline `KeyVault().get` + `get_provider` pairs (the seam sub-project B extends for the keyless Tanzu provider).
- Retire admin-global keys + the `/admin` keys UI; migrate the existing global key(s) onto the admin account so nothing breaks.

## Decisions (locked)
- **Pure per-user** keys; **no admin fallback**. Migrate existing `provider_keys` rows onto the admin user.
- Providers offered: `anthropic`, `openai`, `google` (the current `SUPPORTED_PROVIDERS`). `claude-cli` stays keyless/host-only (unavailable on CF).
- Keys encrypted at rest with the existing `SecretCipher(session_secret)`.

## Architecture

### 1 · Data model + migration
New ORM `UserProviderKey` (`db/models.py`):
- `user_id: UUID` (FK `users.id`, ondelete CASCADE) — composite PK part 1
- `provider: str(32)` — composite PK part 2
- `encrypted_key: Text`
- `created_at`, `updated_at`

Migration `0016_user_provider_keys` (down_revision `0015_github_identity`):
- Create `user_provider_keys`.
- **Data migration:** copy existing global keys onto the admin user —
  `INSERT INTO user_provider_keys (user_id, provider, encrypted_key, created_at, updated_at)
   SELECT (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1), provider, encrypted_key, now(), now()
   FROM provider_keys WHERE EXISTS (SELECT 1 FROM users WHERE role = 'admin')`
  (no-op on a fresh DB where `provider_keys` is empty / no admin yet).
- **Drop `provider_keys`.** Downgrade recreates `provider_keys` (empty) and drops `user_provider_keys`.
- Portable across SQLite (tests use `create_all`) + Postgres: use `op.create_table` / `op.drop_table`; guard the `now()`/INSERT for SQLite by using `op.execute` with `CURRENT_TIMESTAMP` (works on both) — or skip the data copy when the dialect can't express it. The copy only matters on the real Postgres, which supports `now()`.

Remove the `ProviderKey` model class (after the migration drops its table).

### 2 · Per-user KeyVault (`keys/vault.py`)
Make the vault **user-scoped**:
- `KeyVault(user_id: UUID)` — constructor takes the owner.
- `async get(provider) -> str` — decrypted key for `(user_id, provider)`, or `""`. Keeps the `claude-cli` keyless sentinel. **Removes** the myvoice-config fallback (`_read_myvoice_key`).
- `async set(provider, api_key)` / `async delete(provider)` / `async list_status() -> dict[str, bool]` — all scoped to `user_id`; drop the `updated_by` arg (the user is the owner).
- `_check_provider`, `SUPPORTED_PROVIDERS`, and the `SecretCipher` use are unchanged.

### 3 · Resolution helper (`llm/resolve.py`, new)
```python
async def build_provider_for(user_id: UUID, provider: str) -> LLMProvider:
    """Return a ready LLMProvider for `provider` using `user_id`'s key.

    Honors the test mock first so the suite needs no per-user key seeding.
    Raises ProviderMissingKey if the user has no key for a keyed provider.
    """
    if os.environ.get("BLOGFORGE_TEST_PROVIDER") == "mock":
        return get_provider(provider, "mock")
    if provider == "claude-cli":
        return get_provider("claude-cli", "")
    api_key = await KeyVault(user_id).get(provider)
    if not api_key:
        raise ProviderMissingKey(provider)
    return get_provider(provider, api_key)
```
- Honoring `BLOGFORGE_TEST_PROVIDER=mock` first preserves the 8 mock-using test files without seeding keys.
- `ProviderMissingKey` already exists in `llm/exceptions`.

### 4 · Wire the ~13 routes
Replace, in each generation/voice route, the pair
`api_key = await KeyVault().get(<provider>)` … `get_provider(<provider>, api_key)`
with `provider_obj = await build_provider_for(current.id, <provider>)`. Routes: `outline, section, expand, inline, ideation, headlines, repurpose, revise, claims, hero, voice` (+ the providers API). Each already has `current: User = Depends(get_current_user)`. `hero.py` passes the literal `"google"` (Imagen) → `build_provider_for(current.id, "google")`. Where a route currently raises a 400 on a missing key, let `ProviderMissingKey` propagate to the existing handler (or wrap to a 400 with the "add a key in Settings" hint).

### 5 · Per-user keys API (`api/keys.py`, new router `/api/keys`)
All `Depends(get_current_user)`:
- `GET /api/keys` → `{provider: bool}` set/not-set status for the current user (never returns key material).
- `PUT /api/keys/{provider}` body `{api_key: str}` → validate by constructing the provider + a cheap `list_models()` call; on success `KeyVault(current.id).set(...)`; on provider error → 400 with the message. 404 for unknown provider.
- `DELETE /api/keys/{provider}` → `KeyVault(current.id).delete(...)`, 204.

`api/providers.py`: `list_providers` + `list_models` gain `current: User = Depends(get_current_user)` and use `KeyVault(current.id)` / `build_provider_for(current.id, …)`. The `list_models` "missing key" hint changes from "/admin" to "Settings → Provider API keys".

### 6 · Settings UI (`routes/SettingsPage.tsx`, `api/keys.ts` new)
- New **`api/keys.ts`**: `getKeyStatus()`, `setKey(provider, apiKey)`, `deleteKey(provider)`.
- New **`ProviderKeysCard`** on the Account page: a row per provider (Anthropic / OpenAI / Google) showing **Set ✓ / Not set**, a password input + Save, and a Clear button when set. A note under Google: *"Required for hero images."* Keys are write-only from the UI (never fetched back).
- `SetupFields.tsx`: the two error strings that say "An admin can … under /admin (API keys section)" → "Add your key in Settings → Provider API keys."

### 7 · Remove admin keys
- Delete `api/admin_keys.py` and its registration in `server.py` (`admin_keys_router` import + `include_router`).
- Remove the web `/admin` "API keys" section (whatever component renders it; keep user-management).
- Delete the `ProviderKey` model (table dropped by migration 0016).

## Testing
- **`KeyVault(user_id)`**: set→get round-trips per user; two users are isolated; delete; `list_status`; unknown provider raises.
- **`build_provider_for`**: with `BLOGFORGE_TEST_PROVIDER=mock` returns the mock regardless of keys; without mock + a stored key returns the real provider; without a key raises `ProviderMissingKey`; `claude-cli` keyless.
- **`/api/keys`** (authed client): PUT (mock-validated) → GET shows set; DELETE → GET shows not-set; a second user doesn't see the first's status.
- **Migration**: applies + reverses on SQLite; (data copy is Postgres-only, exercised by the boot smoke if convenient — otherwise asserted by reading the migration).
- **Existing suite green**: the 8 mock-env generation tests pass unchanged (helper short-circuits to mock); web `tsc` clean.

## Out of scope
- Bound Tanzu models (sub-project B — extends `build_provider_for` with a keyless `tanzu` branch).
- GitHub-repo blob storage (issue #24).
- Key rotation reminders / per-key usage metering.

## Success criteria
1. A user sets their Anthropic/OpenAI/Google key in Settings; their drafts generate with it; another user with no key gets a clear "add a key" error, not someone else's key.
2. Admin-global keys + the `/admin` keys UI are gone; the previously-global key now belongs to the admin user (generation keeps working for them).
3. Hero images require the user's Google key (surfaced in Settings).
4. New tests pass; existing suite + web `tsc` green; the `build_provider_for` seam is ready for the Tanzu provider.
