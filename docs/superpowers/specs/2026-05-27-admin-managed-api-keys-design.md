# Admin-managed API keys

## Why

Users today see *"No API keys configured in myvoice. Add one in myvoice
Settings before drafting."* That requires leaving Pencraft, configuring
a separate app, and coming back. With Pencraft now multi-user, we want
keys managed inside Pencraft itself.

## What ships

- **Storage.** A `provider_keys` table — one row per provider (anthropic,
  google, openai), holding a Fernet-encrypted ciphertext plus audit
  fields (`updated_at`, `updated_by`).
- **Cipher.** A Fernet key derived from `Settings.session_secret` via
  `urlsafe_b64encode(sha256(secret))` so no extra config is required out
  of the box; operators can override with a dedicated
  `PENCRAFT_KEY_ENCRYPTION_SECRET` setting later if they want
  independent rotation.
- **Admin routes.**
  - `GET /api/admin/keys` — `[{provider, configured, updated_at, updated_by}]`.
    Never returns the secret itself.
  - `PUT /api/admin/keys/{provider}` — body `{"api_key": "..."}`. Validates
    by calling `provider.list_models()` before persisting. 200 with the
    status row on success, 400 with provider error on failure.
  - `DELETE /api/admin/keys/{provider}` — removes; 204.
- **Wiring.** A `KeyVault` service replaces the four scattered calls to
  `~/.myvoice/config.yaml`. Returns the user-stored key if present;
  falls back to the myvoice config if not (backward-compat for existing
  installs that already configured myvoice).
- **UI.** An "API keys" section on `/admin`:
  - Status list per provider (`configured` / `not set`, last edited at, by whom).
  - Inline form to paste a new key (password input, masked).
  - Save button → calls PUT with optimistic validation.
  - "Remove" button → DELETE.
- **Copy updates.** `NewDraftDialog` and `SetupDisclosure` warnings
  switch from "configure myvoice" to "ask an admin to add a key in
  /admin", linking the admin page for admins.

## Out of scope (now)

- Multiple keys per provider (key rotation, A/B testing, dev/prod split).
- Per-user keys (every user brings their own).
- KMS / Vault integration.
- Reveal-key-on-demand UX.

## Risks + decisions

- **Master-secret rotation.** If `session_secret` changes, ciphertexts
  become unreadable. Acceptable for v1 because session cookies also tie
  to that secret (rotating it forces everyone to re-login anyway). When
  we add a dedicated `key_encryption_secret`, rotation gets a proper
  re-encrypt flow.
- **myvoice fallback.** Keeps existing single-user installs working
  without migration. Documented as deprecated; removed once we're
  confident no one relies on it.
- **No reveal.** Per the design choice, the UI never exposes the
  stored key. That makes "did I save it right?" hard to verify, but the
  PUT-time validation (calling `list_models`) catches typos.

## Tests (high level)

- Cipher: round-trip, tamper detection, wrong-secret → fails decrypt.
- KeyVault: prefers stored over myvoice, falls back when not stored,
  returns empty when neither.
- Admin routes: non-admin gets 403, admin can list/put/delete, PUT
  rejects garbage keys via list_models, DELETE is idempotent.
- Wiring: provider availability and list_models routes see stored keys.
- UI: admin section renders status, save calls PUT, remove calls DELETE,
  warning copy points to /admin for admins.
