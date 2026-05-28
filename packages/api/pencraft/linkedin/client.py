"""Thin async LinkedIn API client — create a member post + read its social actions.

Scope is deliberately tiny: the two calls the connector needs. The versioned
`LinkedIn-Version` header is centralized here so a version bump is one line.
"""
from __future__ import annotations

import httpx


class LinkedInError(Exception):
    """A LinkedIn API call failed. `stale_token` flags a 401 so the caller
    can surface a 'reconnect' prompt rather than a generic error."""

    def __init__(self, message: str, *, stale_token: bool = False) -> None:
        super().__init__(message)
        self.stale_token = stale_token


class LinkedInClient:
    def __init__(self, *, access_token: str, api_base: str, api_version: str) -> None:
        self._token = access_token
        self._base = api_base.rstrip("/")
        self._version = api_version

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "LinkedIn-Version": self._version,
            "X-Restli-Protocol-Version": "2.0.0",
            "Content-Type": "application/json",
        }

    async def create_post(
        self,
        *,
        author_urn: str,
        commentary: str,
        visibility: str = "PUBLIC",
    ) -> str:
        """Publish a member feed post. Returns the post URN (from x-restli-id)."""
        body = {
            "author": author_urn,
            "commentary": commentary,
            "visibility": visibility,
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
            "lifecycleState": "PUBLISHED",
        }
        async with httpx.AsyncClient(timeout=15.0) as http:
            resp = await http.post(
                f"{self._base}/rest/posts", headers=self._headers(), json=body
            )
        if resp.status_code == 401:
            raise LinkedInError("LinkedIn token expired", stale_token=True)
        if resp.status_code not in (200, 201):
            raise LinkedInError(
                f"create_post failed ({resp.status_code}): {resp.text[:300]}"
            )
        urn = resp.headers.get("x-restli-id")
        if not urn:
            raise LinkedInError("create_post succeeded but no post URN in response")
        return urn

    async def social_actions(self, post_urn: str) -> dict[str, int]:
        """Return {likes, comments} for a post. The ceiling for member posts —
        LinkedIn doesn't expose impressions/reach here."""
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.get(
                f"{self._base}/v2/socialActions/{post_urn}", headers=self._headers()
            )
        if resp.status_code == 401:
            raise LinkedInError("LinkedIn token expired", stale_token=True)
        if resp.status_code != 200:
            raise LinkedInError(
                f"social_actions failed ({resp.status_code}): {resp.text[:300]}"
            )
        data = resp.json()
        return {
            "likes": int((data.get("likesSummary") or {}).get("totalLikes", 0)),
            "comments": int((data.get("commentsSummary") or {}).get("totalComments", 0)),
        }
