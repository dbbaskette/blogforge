# Per-User API Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move LLM provider keys from admin-global to per-user (entered in Settings); generation uses the current user's key via a single `build_provider_for(user_id, provider)` helper.

**Architecture:** New `user_provider_keys` table + user-scoped `KeyVault(user_id)`; a `build_provider_for` resolution helper (honoring the test mock) replaces ~13 inline key lookups; new `/api/keys` router + a Settings card; admin-global keys + `/admin` keys UI removed; existing global key migrated onto the admin user.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic, React/TS, pytest, vitest.

> **Spec:** `docs/superpowers/specs/2026-06-19-per-user-api-keys-design.md`
> **Test:** `cd /Users/dbbaskette/Projects/BlogForge && .venv/bin/python -m pytest <path> -q`. `asyncio_mode=auto`. Web from `packages/web`: `./node_modules/.bin/tsc --noEmit`.
> **Facts:** `SUPPORTED_PROVIDERS = ("anthropic","openai","google")`. `get_provider(name, api_key)` returns `MockProvider` when `BLOGFORGE_TEST_PROVIDER=mock`. `ProviderMissingKey` is in `blogforge.llm.exceptions`. Tests build schema via `Base.metadata.create_all` (migrations run only on real boot). alembic head = `0015_github_identity`.

---

## Task 1: UserProviderKey model + migration 0016

**Files:** Modify `packages/api/blogforge/db/models.py`; Create `packages/api/alembic/versions/0016_user_provider_keys.py`

- [ ] **Step 1: Add the model** to `db/models.py` (near the old `ProviderKey`; leave `ProviderKey` for now — removed in Task 4):
```python
class UserProviderKey(Base):
    """Per-user, encrypted LLM provider API key."""
    __tablename__ = "user_provider_keys"

    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    provider: Mapped[str] = mapped_column(String(32), primary_key=True)
    encrypted_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
```

- [ ] **Step 2: Create the migration** `packages/api/alembic/versions/0016_user_provider_keys.py`:
```python
"""user_provider_keys — per-user keys; migrate global keys to the admin user."""
from alembic import op
import sqlalchemy as sa

revision = "0016_user_provider_keys"
down_revision = "0015_github_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_provider_keys",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("provider", sa.String(length=32), primary_key=True),
        sa.Column("encrypted_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Migrate any existing global keys onto the admin user (Postgres prod path;
    # no-op on a fresh DB where provider_keys is empty or no admin exists).
    op.execute(
        """
        INSERT INTO user_provider_keys (user_id, provider, encrypted_key, created_at, updated_at)
        SELECT u.id, pk.provider, pk.encrypted_key, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM provider_keys pk
        CROSS JOIN (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1) u
        """
    )
    op.drop_table("provider_keys")


def downgrade() -> None:
    op.create_table(
        "provider_keys",
        sa.Column("provider", sa.String(length=32), primary_key=True),
        sa.Column("encrypted_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.drop_table("user_provider_keys")
```

- [ ] **Step 3: Verify migration up/down on throwaway SQLite:**
```bash
cd /Users/dbbaskette/Projects/BlogForge
rm -f .tmp-mig.db
BLOGFORGE_DATABASE_URL="sqlite+aiosqlite:///./.tmp-mig.db" .venv/bin/python -c "
from alembic import command; from alembic.config import Config; import pathlib
r=pathlib.Path('packages/api'); c=Config(str(r/'alembic.ini')); c.set_main_option('script_location', str(r/'alembic'))
command.upgrade(c,'head'); print('UPGRADE OK'); command.downgrade(c,'0015_github_identity'); print('DOWNGRADE OK')"
rm -f .tmp-mig.db
```
Expected: `UPGRADE OK` then `DOWNGRADE OK`. (The data-copy INSERT is a no-op on the empty fresh DB.)

- [ ] **Step 4: Commit**
```bash
git add packages/api/blogforge/db/models.py packages/api/alembic/versions/0016_user_provider_keys.py
git commit -m "feat(api): user_provider_keys table + migration (global keys -> admin)"
```

---

## Task 2: Per-user KeyVault

**Files:** Modify `packages/api/blogforge/keys/vault.py`; Test `packages/api/tests/test_user_keyvault.py`

- [ ] **Step 1: Write failing tests** `packages/api/tests/test_user_keyvault.py`. These take NO DB fixture: the autouse `_force_sqlite_for_tests` fixture create_all's the schema on the app-wide engine that `KeyVault`'s `get_sessionmaker()` uses. Do **not** use the standalone `session` fixture — it's a *separate* engine `KeyVault` never touches.
```python
import uuid
import pytest
from blogforge.keys import KeyVault


async def test_set_get_roundtrip_is_user_scoped() -> None:
    u1, u2 = uuid.uuid4(), uuid.uuid4()
    await KeyVault(u1).set("anthropic", "sk-ant-u1")
    assert await KeyVault(u1).get("anthropic") == "sk-ant-u1"
    assert await KeyVault(u2).get("anthropic") == ""          # isolated per user

async def test_delete_and_status() -> None:
    u = uuid.uuid4()
    await KeyVault(u).set("openai", "sk-u")
    assert (await KeyVault(u).list_status())["openai"] is True
    await KeyVault(u).delete("openai")
    assert (await KeyVault(u).list_status())["openai"] is False

async def test_unknown_provider_raises() -> None:
    with pytest.raises(ValueError):
        await KeyVault(uuid.uuid4()).get("bogus")
```

- [ ] **Step 2: Run → FAIL** (`KeyVault(u1)` — constructor takes no arg yet).

- [ ] **Step 3: Refactor `keys/vault.py`** to be user-scoped:
  - `class KeyVault:` gains `def __init__(self, user_id: UUID) -> None: self._user_id = user_id`.
  - `get(self, provider)`: keep the `claude-cli` sentinel branch; then `_check_provider`; load the row WHERE `user_id == self._user_id AND provider == provider` from `user_provider_keys` (use the `UserProviderKey` model); decrypt or return `""`. **Remove** the `_read_myvoice_key` fallback + its import.
  - `set(self, provider, api_key)`: drop `updated_by`; upsert the `(user_id, provider)` row.
  - `delete(self, provider)`: delete the `(user_id, provider)` row.
  - `list_status(self) -> dict[str, bool]`: `{p: bool(await self.get(p)) for p in SUPPORTED_PROVIDERS}` (or a single query); keep returning all `SUPPORTED_PROVIDERS`.
  - Update `_load` to filter by `user_id`. Keep `SUPPORTED_PROVIDERS`, `_check_provider`, `_cipher`.

- [ ] **Step 4: Run → PASS** `.venv/bin/python -m pytest packages/api/tests/test_user_keyvault.py -q` (3 passed).

- [ ] **Step 5: Commit**
```bash
git add packages/api/blogforge/keys/vault.py packages/api/tests/test_user_keyvault.py
git commit -m "feat(api): user-scoped KeyVault (KeyVault(user_id))"
```

---

## Task 3: `build_provider_for` resolution helper

**Files:** Create `packages/api/blogforge/llm/resolve.py`; Test `packages/api/tests/llm/test_resolve.py`

- [ ] **Step 1: Write failing tests** `packages/api/tests/llm/test_resolve.py` (create `tests/llm/__init__.py` if missing):
```python
import uuid
import pytest
from blogforge.llm.resolve import build_provider_for
from blogforge.llm.exceptions import ProviderMissingKey


async def test_mock_env_short_circuits(monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    p = await build_provider_for(uuid.uuid4(), "anthropic")
    assert p.__class__.__name__ == "MockProvider"

async def test_missing_key_raises(monkeypatch) -> None:
    monkeypatch.delenv("BLOGFORGE_TEST_PROVIDER", raising=False)
    with pytest.raises(ProviderMissingKey):
        await build_provider_for(uuid.uuid4(), "anthropic")

async def test_stored_key_builds_real_provider(monkeypatch) -> None:
    monkeypatch.delenv("BLOGFORGE_TEST_PROVIDER", raising=False)
    from blogforge.keys import KeyVault
    u = uuid.uuid4()
    await KeyVault(u).set("anthropic", "sk-ant-real")
    p = await build_provider_for(u, "anthropic")
    assert p.__class__.__name__ == "AnthropicProvider"
```
(No DB fixture — same shared-app-engine reasoning as Task 2 Step 1.)

- [ ] **Step 2: Run → FAIL** (ModuleNotFoundError: blogforge.llm.resolve).

- [ ] **Step 3: Implement `packages/api/blogforge/llm/resolve.py`:**
```python
"""Resolve (user, provider) -> a ready LLMProvider using the user's stored key."""
from __future__ import annotations

import os
from uuid import UUID

from blogforge.keys import KeyVault
from blogforge.llm.base import LLMProvider
from blogforge.llm.exceptions import ProviderMissingKey
from blogforge.llm.registry import get_provider


async def build_provider_for(user_id: UUID, provider: str) -> LLMProvider:
    if os.environ.get("BLOGFORGE_TEST_PROVIDER") == "mock":
        return get_provider(provider, "mock")
    if provider == "claude-cli":
        return get_provider("claude-cli", "")
    api_key = await KeyVault(user_id).get(provider)
    if not api_key:
        raise ProviderMissingKey(provider)
    return get_provider(provider, api_key)
```
> Confirm `ProviderMissingKey`'s constructor signature in `llm/exceptions.py` (e.g. it may take the provider name or a message); call it accordingly.

- [ ] **Step 4: Run → PASS**; then **Step 5: Commit**
```bash
git add packages/api/blogforge/llm/resolve.py packages/api/tests/llm
git commit -m "feat(api): build_provider_for(user_id, provider) resolution helper"
```

---

## Task 4: Wire routes through the helper; remove admin-global keys

**Files:** Modify the ~13 generation/voice routes, `server.py`; Delete `api/admin_keys.py`; Remove `ProviderKey` model

- [ ] **Step 1: Add a global `ProviderMissingKey` → 400 handler** in `server.py` `create_app` (so routes needn't each catch it). Near the other handlers/middleware:
```python
from blogforge.llm.exceptions import ProviderMissingKey
from fastapi import Request as _Req
from fastapi.responses import JSONResponse

@app.exception_handler(ProviderMissingKey)
async def _missing_key(_: _Req, exc: ProviderMissingKey) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"error": {"code": "provider_missing_key",
                           "message": str(exc) or "No API key configured for this provider.",
                           "hint": "Add your key in Settings → Provider API keys."}},
    )
```

- [ ] **Step 2: Rewire each route.** In every file below, replace the pair
  `api_key = await KeyVault().get(<P>)` (+ any `if not api_key: raise …` guard) and the later
  `get_provider(<P>, api_key)` → a single `provider = await build_provider_for(current.id, <P>)`.
  Add `from blogforge.llm.resolve import build_provider_for`; drop the now-unused `KeyVault`/`get_provider` imports per file.
  Files (each has `current: User = Depends(get_current_user)`): `api/outline.py`, `api/section.py`, `api/expand.py`, `api/inline.py`, `api/ideation.py`, `api/headlines.py`, `api/repurpose.py`, `api/revise.py`, `api/claims.py`, `api/hero.py` (uses literal `"google"` → `build_provider_for(current.id, "google")`), `api/voice.py` (the distill path: `build_provider_for(current.id, provider_name)`).
  Grep to confirm none remain: `grep -rn "KeyVault()" packages/api/blogforge/api | grep -v admin_keys` → only the providers/keys routers (Task 5) should reference a vault, and as `KeyVault(current.id)`.

- [ ] **Step 3: Remove admin keys.** Delete `packages/api/blogforge/api/admin_keys.py`; in `server.py` remove the `from blogforge.api.admin_keys import router as admin_keys_router` line and the `app.include_router(admin_keys_router)` line. Delete the `ProviderKey` class from `db/models.py` (its table is dropped by migration 0016). `grep -rn "ProviderKey\b\|admin_keys" packages/api/blogforge` → no references remain (the migration's recreate in `downgrade` uses raw `op.create_table`, not the model, so that's fine).

- [ ] **Step 4: Trim/adjust tests** that exercised admin keys: `grep -rln "admin_keys\|/api/admin/keys\|ProviderKey" packages/api/tests` → delete the admin-keys endpoint tests; if `conftest` seeds a global key for generation tests, that's unnecessary now (the mock env handles it) — remove such seeding only if it breaks.

- [ ] **Step 5: Full suite green** `.venv/bin/python -m pytest packages/api -q`. The 8 mock-env generation tests must pass unchanged. If a generation test now 400s with `provider_missing_key`, it wasn't setting `BLOGFORGE_TEST_PROVIDER=mock` — confirm it does, or add it.

- [ ] **Step 6: Commit**
```bash
git add packages/api/blogforge pyproject.toml packages/api/tests
git commit -m "refactor(api): route generation through build_provider_for; remove admin-global keys"
```

---

## Task 5: Per-user keys API + per-user providers API

**Files:** Create `packages/api/blogforge/api/keys.py`; Modify `packages/api/blogforge/api/providers.py`, `server.py`; Test `packages/api/tests/api/test_user_keys_api.py`

- [ ] **Step 1: Write failing endpoint tests** `packages/api/tests/api/test_user_keys_api.py`:
```python
def test_set_get_delete_key(authed_client, monkeypatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")  # PUT validation uses the provider
    client, _uid = authed_client
    assert client.get("/api/keys").json()["anthropic"] is False
    r = client.put("/api/keys/anthropic", json={"api_key": "sk-x"})
    assert r.status_code in (200, 204)
    assert client.get("/api/keys").json()["anthropic"] is True
    client.delete("/api/keys/anthropic")
    assert client.get("/api/keys").json()["anthropic"] is False

def test_unknown_provider_404(authed_client) -> None:
    client, _ = authed_client
    assert client.put("/api/keys/bogus", json={"api_key": "x"}).status_code == 404
```

- [ ] **Step 2: Run → FAIL** (404, no router).

- [ ] **Step 3: Implement `packages/api/blogforge/api/keys.py`:**
```python
"""Per-user provider API keys (Settings)."""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.keys import SUPPORTED_PROVIDERS, KeyVault
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.registry import get_provider

router = APIRouter(prefix="/api/keys", tags=["keys"])


class KeyBody(BaseModel):
    api_key: str


def _check(provider: str) -> None:
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(404, detail={"error": {"code": "unknown_provider",
            "message": f"Unknown provider '{provider}'"}})


@router.get("")
async def status_map(current: User = Depends(get_current_user)) -> dict[str, bool]:
    return await KeyVault(current.id).list_status()


@router.put("/{provider}")
async def set_key(provider: str, body: KeyBody, current: User = Depends(get_current_user)) -> dict[str, str]:
    _check(provider)
    if not body.api_key.strip():
        raise HTTPException(400, detail={"error": {"code": "empty_key", "message": "Key must not be empty."}})
    # Validate the key by listing models (skipped automatically under the test mock).
    try:
        await get_provider(provider, body.api_key).list_models()
    except (ProviderError, ProviderMissingKey) as exc:
        raise HTTPException(400, detail={"error": {"code": "invalid_key", "message": str(exc)}}) from exc
    await KeyVault(current.id).set(provider, body.api_key)
    return {"status": "ok"}


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_key(provider: str, current: User = Depends(get_current_user)) -> Response:
    _check(provider)
    await KeyVault(current.id).delete(provider)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```
Register it in `server.py` (`from blogforge.api.keys import router as keys_router` + `app.include_router(keys_router)`).

- [ ] **Step 4: Make `api/providers.py` per-user.** Add `current: User = Depends(get_current_user)` to `list_providers` and `list_models`; use `KeyVault(current.id)` / `build_provider_for(current.id, provider)`; change the missing-key `hint` to `"Add your key in Settings → Provider API keys."` Keep the response shapes.

- [ ] **Step 5: Run → PASS** `.venv/bin/python -m pytest packages/api/tests/api/test_user_keys_api.py -q`; then full suite `.venv/bin/python -m pytest packages/api -q`.

- [ ] **Step 6: Commit**
```bash
git add packages/api/blogforge/api/keys.py packages/api/blogforge/api/providers.py packages/api/blogforge/server.py packages/api/tests/api/test_user_keys_api.py
git commit -m "feat(api): /api/keys per-user key management; providers API per-user"
```

---

## Task 6: Settings UI + SetupFields copy; remove /admin keys section

**Files:** Create `packages/web/src/api/keys.ts`, `packages/web/src/components/settings/ProviderKeysCard.tsx`; Modify `packages/web/src/routes/SettingsPage.tsx`, `packages/web/src/components/SetupFields.tsx`, the `/admin` keys component

- [ ] **Step 1: `packages/web/src/api/keys.ts`:**
```ts
import { api } from "./client";

export type KeyStatus = Record<string, boolean>;
export const getKeyStatus = (): Promise<KeyStatus> => api<KeyStatus>("/api/keys");
export const setKey = (provider: string, apiKey: string): Promise<{ status: string }> =>
  api(`/api/keys/${provider}`, { method: "PUT", body: JSON.stringify({ api_key: apiKey }) });
export const deleteKey = (provider: string): Promise<void> =>
  api(`/api/keys/${provider}`, { method: "DELETE" });
```

- [ ] **Step 2: `ProviderKeysCard.tsx`** — a card matching the existing `SessionsCard` styling (read `SettingsPage.tsx` for the card/heading classes). For each of `anthropic`/`openai`/`google`: show **Set ✓ / Not set** (from `getKeyStatus`), a `type="password"` input + **Save** (calls `setKey`, then refresh status), and a **Clear** button when set (calls `deleteKey`). Under Google add the note: *"Required for hero images."* On a `setKey` 400, show the returned error message inline. Never display stored key material.

- [ ] **Step 3: Mount it** in `SettingsPage.tsx` — render `<ProviderKeysCard />` above or below `<SessionsCard />`.

- [ ] **Step 4: `SetupFields.tsx`** — replace the two error strings mentioning "An admin can … /admin (API keys section)" with: `Add your key in Settings → Provider API keys.`

- [ ] **Step 5: Remove the `/admin` API-keys section.** Find it: `grep -rn "API keys\|admin/keys\|provider key" packages/web/src/routes` — remove that section/component from the admin page (keep user management). Remove any now-dead `api/adminKeys.ts`-style client.

- [ ] **Step 6: Verify** from `packages/web`: `./node_modules/.bin/tsc --noEmit` (clean) and `./node_modules/.bin/vitest run` (update any admin-keys test that referenced the removed section; add a small test that `ProviderKeysCard` renders the three providers if the suite tests cards).

- [ ] **Step 7: Commit**
```bash
git add packages/web/src
git commit -m "feat(web): per-user Provider API keys in Settings; drop /admin keys UI"
```

---

## Self-Review Notes
- **Spec coverage:** table+migration+data-copy → T1; user-scoped vault → T2; `build_provider_for` (+mock) → T3; route rewiring + admin-keys removal + ProviderKey delete → T4; `/api/keys` + per-user providers → T5; Settings card + SetupFields copy + /admin keys removal → T6. Hero gating = the Google-key note (T6) + hero routed through the helper (T4).
- **Type consistency:** `KeyVault(user_id)` (T2) used by `build_provider_for` (T3), `/api/keys` (T5); `build_provider_for(user_id, provider)` used in T4/T5; `getKeyStatus/setKey/deleteKey` (T6) match the `/api/keys` shapes (T5).
- **Adapt-on-contact:** the test fixture that shares the vault's engine (T2/T3 Step 1); `ProviderMissingKey` constructor (T3); the exact `/admin` keys component + any global-key seeding in conftest (T4/T6).
