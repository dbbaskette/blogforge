"""GET /api/auth/github/login + /callback — GitHub OAuth Authorization Code."""
from __future__ import annotations

import secrets
from typing import Literal, cast
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from blogforge.auth.dependencies import _get_session, _get_signer
from blogforge.auth.github import resolve_github_user
from blogforge.auth.github_client import GithubAuthError, exchange_code, fetch_identity
from blogforge.auth.sessions import COOKIE_MAX_AGE_SECONDS, COOKIE_NAME
from blogforge.config import get_settings

router = APIRouter(prefix="/api/auth/github", tags=["auth"])

_STATE_COOKIE = "bf_oauth_state"


def _base_url(request: Request) -> str:
    s = get_settings()
    return s.public_url.rstrip("/") if s.public_url else str(request.base_url).rstrip("/")


@router.get("/login")
async def github_login(request: Request) -> RedirectResponse:
    s = get_settings()
    if not s.github_client_id or not s.github_client_secret:
        return RedirectResponse(url="/login?error=github_not_configured", status_code=302)
    state = secrets.token_urlsafe(24)
    redirect_uri = f"{_base_url(request)}/api/auth/github/callback"
    params = urlencode({
        "client_id": s.github_client_id,
        "redirect_uri": redirect_uri,
        "scope": "read:user user:email",
        "state": state,
    })
    resp = RedirectResponse(url=f"https://github.com/login/oauth/authorize?{params}", status_code=302)
    # samesite=lax (not the configurable session value): the GitHub callback is a
    # top-level GET navigation, so the state cookie must be sent on that cross-site
    # redirect. Do not change to strict/none — it would break the OAuth handshake.
    resp.set_cookie(_STATE_COOKIE, state, max_age=600, httponly=True,
                    secure=s.cookie_secure, samesite="lax", path="/")
    return resp


@router.get("/callback")
async def github_callback(
    request: Request,
    code: str = "",
    state: str = "",
    error: str = "",
    session: AsyncSession = Depends(_get_session),
) -> RedirectResponse:
    s = get_settings()
    cookie_state = request.cookies.get(_STATE_COOKIE)
    if not state or not cookie_state or not secrets.compare_digest(state, cookie_state):
        return RedirectResponse(url="/login?error=bad_state", status_code=302)
    # User cancelled on GitHub, or GitHub returned an error: no usable code.
    if error or not code:
        resp = RedirectResponse(url="/login?error=oauth_denied", status_code=302)
        resp.delete_cookie(_STATE_COOKIE, path="/")
        return resp
    try:
        token = await exchange_code(code, f"{_base_url(request)}/api/auth/github/callback")
        ident = await fetch_identity(token)
    except (httpx.HTTPError, GithubAuthError, KeyError, ValueError):
        return RedirectResponse(url="/login?error=github_failed", status_code=302)

    user = await resolve_github_user(session, ident)
    if user is None:
        resp = RedirectResponse(url="/login?error=not_allowed", status_code=302)
        resp.delete_cookie(_STATE_COOKIE, path="/")
        return resp

    resp = RedirectResponse(url="/", status_code=302)
    resp.delete_cookie(_STATE_COOKIE, path="/")
    resp.set_cookie(
        COOKIE_NAME,
        _get_signer().sign(user.id, user.session_version),
        max_age=COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=s.cookie_secure,
        samesite=cast(Literal["lax", "strict", "none"], s.cookie_samesite),
        path="/",
    )
    return resp
