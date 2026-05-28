"""LinkedIn connector routes: health, OAuth (connect/callback/status/disconnect).

Publish + stats land in the next task. All authed routes resolve the user
from Pencraft's shared session cookie via get_current_user.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select

from pencraft import __version__
from pencraft.auth.crypto import SecretCipher
from pencraft.auth.dependencies import _get_session, get_current_user
from pencraft.config import get_settings
from pencraft.db.models import LinkedInConnection, User
from pencraft.linkedin.config import get_linkedin_settings
from pencraft.linkedin.state import sign_state, verify_state

router = APIRouter(prefix="/linkedin", tags=["linkedin"])


def _cipher() -> SecretCipher:
    return SecretCipher(get_settings().session_secret)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@router.get("/connect")
async def connect(current: User = Depends(get_current_user)) -> dict[str, str]:
    """Return the LinkedIn authorize URL with a signed state carrying the user id."""
    li = get_linkedin_settings()
    state = sign_state(current.id, secret=get_settings().session_secret)
    params = {
        "response_type": "code",
        "client_id": li.client_id,
        "redirect_uri": li.redirect_uri,
        "scope": li.scopes,
        "state": state,
    }
    return {"authorize_url": f"{li.authorize_url}?{urlencode(params)}"}


@router.get("/callback")
async def callback(
    code: str = Query(...),
    state: str = Query(...),
    session=Depends(_get_session),
) -> RedirectResponse:
    """OAuth redirect target. Verify state, exchange the code, fetch the
    member identity, persist an encrypted connection, bounce back to Pencraft.

    Note: this route does NOT use get_current_user — the browser arrives
    here from LinkedIn without our cookie guaranteed; the signed `state`
    is what authenticates the user.
    """
    li = get_linkedin_settings()
    user_id = verify_state(state, secret=get_settings().session_secret)
    if user_id is None:
        raise HTTPException(status_code=400, detail="invalid_state")

    async with httpx.AsyncClient(timeout=10.0) as http:
        token_resp = await http.post(
            li.token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": li.redirect_uri,
                "client_id": li.client_id,
                "client_secret": li.client_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if token_resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail={"error": {"code": "token_exchange_failed", "message": token_resp.text[:300]}},
            )
        tok = token_resp.json()
        access_token = tok["access_token"]
        expires_in = int(tok.get("expires_in", 0))
        scope = tok.get("scope", li.scopes)

        info_resp = await http.get(
            li.userinfo_url, headers={"Authorization": f"Bearer {access_token}"}
        )
        if info_resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail={"error": {"code": "userinfo_failed", "message": info_resp.text[:300]}},
            )
        info = info_resp.json()

    member_urn = f"urn:li:person:{info['sub']}"
    member_name = str(info.get("name", ""))
    expires_at = datetime.now(UTC) + timedelta(seconds=expires_in or 0)
    ciphertext = _cipher().encrypt(access_token)

    existing = (
        await session.execute(
            select(LinkedInConnection).where(LinkedInConnection.user_id == user_id)
        )
    ).scalar_one_or_none()
    if existing is None:
        session.add(
            LinkedInConnection(
                user_id=user_id,
                member_urn=member_urn,
                member_name=member_name,
                encrypted_access_token=ciphertext,
                scope=scope,
                expires_at=expires_at,
            )
        )
    else:
        existing.member_urn = member_urn
        existing.member_name = member_name
        existing.encrypted_access_token = ciphertext
        existing.scope = scope
        existing.expires_at = expires_at
    await session.commit()

    return RedirectResponse(url=li.post_connect_redirect, status_code=302)


@router.get("/status")
async def status_(
    current: User = Depends(get_current_user),
    session=Depends(_get_session),
) -> dict[str, object]:
    conn = (
        await session.execute(
            select(LinkedInConnection).where(LinkedInConnection.user_id == current.id)
        )
    ).scalar_one_or_none()
    if conn is None:
        return {"connected": False}
    return {
        "connected": True,
        "member_name": conn.member_name,
        "expires_at": conn.expires_at.isoformat(),
    }


@router.delete("/connection", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(
    current: User = Depends(get_current_user),
    session=Depends(_get_session),
) -> Response:
    await session.execute(
        delete(LinkedInConnection).where(LinkedInConnection.user_id == current.id)
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
