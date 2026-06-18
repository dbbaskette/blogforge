"""GitHub OAuth HTTP calls (token exchange + identity)."""
from __future__ import annotations

import httpx

from blogforge.auth.github import GithubIdentity
from blogforge.config import get_settings
from blogforge.llm.exceptions import ProviderError  # reuse a generic error type

_GH = "https://github.com"
_API = "https://api.github.com"


async def exchange_code(code: str, redirect_uri: str) -> str:
    s = get_settings()
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{_GH}/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": s.github_client_id,
                "client_secret": s.github_client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
    resp.raise_for_status()
    token = resp.json().get("access_token")
    if not token:
        raise ProviderError("GitHub did not return an access token")
    return token


async def fetch_identity(token: str) -> GithubIdentity:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    async with httpx.AsyncClient(timeout=15) as client:
        u = (await client.get(f"{_API}/user", headers=headers)).raise_for_status().json()
        email = u.get("email")
        if not email:
            emails = (await client.get(f"{_API}/user/emails", headers=headers)).json()
            primary = next((e for e in emails if e.get("primary") and e.get("verified")), None)
            email = primary.get("email") if primary else None
    return GithubIdentity(
        id=int(u["id"]), login=u["login"], email=email, avatar_url=u.get("avatar_url")
    )
