"""Reference library — promote a draft ref, reuse it in another draft."""
from __future__ import annotations

import os
from collections.abc import AsyncIterator
from unittest import mock

import pytest_asyncio
from fastapi.testclient import TestClient
from moto.server import ThreadedMotoServer

from blogforge.auth.passwords import hash_password
from blogforge.auth.sessions import COOKIE_NAME, SessionSigner
from blogforge.config import get_settings
from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import User
from blogforge.s3 import get_s3_client, reset_s3_client_for_tests
from blogforge.s3.lifespan import ensure_bucket
from blogforge.server import create_app


@pytest_asyncio.fixture
async def s3_env() -> AsyncIterator[str]:
    server = ThreadedMotoServer(port=0)
    server.start()
    host, port = server.get_host_and_port()
    endpoint = f"http://{host}:{port}"
    env = {
        "BLOGFORGE_S3_ENDPOINT_URL": endpoint,
        "BLOGFORGE_S3_ACCESS_KEY": "test",
        "BLOGFORGE_S3_SECRET_KEY": "test",
        "BLOGFORGE_S3_BUCKET": "blogforge-test",
        "BLOGFORGE_S3_REGION": "us-east-1",
    }
    with mock.patch.dict(os.environ, env, clear=False):
        get_settings.cache_clear()
        reset_s3_client_for_tests()
        await ensure_bucket()
        try:
            yield endpoint
        finally:
            reset_s3_client_for_tests()
            get_settings.cache_clear()
            server.stop()


async def _seed_user(email: str):
    async with get_sessionmaker()() as session:
        user = User(email=email, password_hash=hash_password("x"), status="approved", role="user")
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user.id


def _signed_client(uid) -> TestClient:
    app = create_app()
    c = TestClient(app)
    c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(uid))
    return c


@pytest_asyncio.fixture
async def authed(s3_env: str):
    uid = await _seed_user("lib-test@user.com")
    c = _signed_client(uid)
    with c:
        yield c, uid


def _idea() -> dict[str, object]:
    return {"topic": "T", "pack_slug": "dan", "provider": "anthropic", "model": "m"}


def _draft(client: TestClient) -> str:
    return client.post("/api/drafts", json=_idea()).json()["id"]


def _add_text_ref(client: TestClient, draft_id: str, name: str, content: str) -> str:
    r = client.post(
        f"/api/drafts/{draft_id}/references/text", json={"name": name, "content": content}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_promote_then_reuse_round_trips_content(authed) -> None:
    client, _ = authed
    d1 = _draft(client)
    ref_id = _add_text_ref(client, d1, "My notes", "Reusable knowledge here.")

    # Promote into the library.
    promoted = client.post(f"/api/library/references/from-draft/{d1}/{ref_id}")
    assert promoted.status_code == 201, promoted.text
    lib_id = promoted.json()["id"]
    assert promoted.json()["name"] == "My notes"

    # It shows in the library listing.
    assert lib_id in [x["id"] for x in client.get("/api/library/references").json()]

    # Reuse it in a *different* draft.
    d2 = _draft(client)
    added = client.post(f"/api/drafts/{d2}/references/from-library/{lib_id}")
    assert added.status_code == 201, added.text
    new_ref_id = added.json()["id"]
    assert added.json()["name"] == "My notes"
    assert new_ref_id != ref_id  # fresh draft-scoped id

    # The extracted content was copied under the new draft's prefix.
    s3 = get_s3_client()
    extracted = await s3.get_object(f"drafts/{d2}/references/extracted/{new_ref_id}.md")
    assert extracted.decode("utf-8") == "Reusable knowledge here."

    # And it lists on the new draft.
    assert new_ref_id in [r["id"] for r in client.get(f"/api/drafts/{d2}/references").json()]


async def test_delete_library_reference(authed) -> None:
    client, _ = authed
    d1 = _draft(client)
    ref_id = _add_text_ref(client, d1, "Doomed", "bye")
    lib_id = client.post(f"/api/library/references/from-draft/{d1}/{ref_id}").json()["id"]

    assert client.delete(f"/api/library/references/{lib_id}").status_code == 204
    assert client.get("/api/library/references").json() == []


async def test_promote_unknown_reference_404(authed) -> None:
    client, _ = authed
    d1 = _draft(client)
    r = client.post(f"/api/library/references/from-draft/{d1}/ref-nope")
    assert r.status_code == 404
    assert r.json()["detail"]["error"]["code"] == "reference_not_found"


async def test_add_from_unknown_library_404(authed) -> None:
    client, _ = authed
    d1 = _draft(client)
    r = client.post(f"/api/drafts/{d1}/references/from-library/lib-nope")
    assert r.status_code == 404
    assert r.json()["detail"]["error"]["code"] == "library_reference_not_found"


async def test_library_scoped_per_user(authed, s3_env) -> None:
    client, _ = authed
    d1 = _draft(client)
    ref_id = _add_text_ref(client, d1, "Mine", "secret")
    lib_id = client.post(f"/api/library/references/from-draft/{d1}/{ref_id}").json()["id"]

    other_id = await _seed_user("lib-other@user.com")
    with _signed_client(other_id) as other:
        assert other.get("/api/library/references").json() == []
        assert other.delete(f"/api/library/references/{lib_id}").status_code == 404
