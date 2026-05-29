"""Unhandled exceptions return a 500 with a greppable error id + are logged."""
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pencraft.errors import install_exception_handler


@pytest.fixture
def boom_app():
    app = FastAPI()
    install_exception_handler(app)

    @app.get("/boom")
    async def boom() -> dict[str, str]:
        raise RuntimeError("kaboom")

    return app


def test_500_returns_error_id_in_body(boom_app):
    with TestClient(boom_app, raise_server_exceptions=False) as c:
        r = c.get("/boom")
        assert r.status_code == 500
        body = r.json()
        assert body["error"]["code"] == "internal_error"
        assert body["error"]["id"]  # a short id the user can quote


def test_500_logs_traceback_with_id_and_path(boom_app, caplog):
    with caplog.at_level(logging.ERROR, logger="pencraft.errors"):
        with TestClient(boom_app, raise_server_exceptions=False) as c:
            r = c.get("/boom")
            err_id = r.json()["error"]["id"]
    # The same id appears in the logs, alongside the path + the traceback.
    joined = "\n".join(rec.getMessage() for rec in caplog.records)
    assert err_id in joined
    assert "/boom" in joined
    assert "RuntimeError" in caplog.text  # exc_info rendered
    assert "kaboom" in caplog.text


def test_http_exceptions_pass_through(boom_app):
    """Explicit HTTPExceptions (4xx) are not swallowed by the 500 handler."""
    from fastapi import HTTPException

    @boom_app.get("/notfound")
    async def notfound() -> None:
        raise HTTPException(status_code=404, detail="nope")

    with TestClient(boom_app, raise_server_exceptions=False) as c:
        r = c.get("/notfound")
        assert r.status_code == 404
        assert r.json()["detail"] == "nope"
