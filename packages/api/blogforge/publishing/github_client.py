"""Small, token-safe wrapper around GitHub's repository Contents API."""

from __future__ import annotations

import base64
import math
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

_API = "https://api.github.com"
_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


class PublishingError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int,
        *,
        retry_after: int | None = None,
        repository_url: str | None = None,
        path: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.retry_after = retry_after
        self.repository_url = repository_url
        self.path = path


@dataclass(frozen=True)
class GitHubIdentityAccess:
    login: str
    private: bool
    can_push: bool


@dataclass(frozen=True)
class GitHubContent:
    sha: str
    html_url: str


@dataclass(frozen=True)
class GitHubCommitResult:
    content_sha: str
    content_url: str
    commit_sha: str
    commit_url: str


class GitHubPublisherClient:
    def __init__(
        self,
        token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._headers = {**_HEADERS, "Authorization": f"Bearer {token}"}
        self._transport = transport

    async def _send(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            async with httpx.AsyncClient(
                base_url=_API,
                headers=self._headers,
                timeout=15,
                transport=self._transport,
            ) as client:
                return await client.request(method, path, **kwargs)
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            raise PublishingError(
                "github_unavailable",
                "GitHub could not be reached. Try publishing again.",
                503,
            ) from exc

    @staticmethod
    def _json_object(response: httpx.Response) -> dict[str, Any]:
        try:
            body = response.json()
        except ValueError as exc:
            raise PublishingError(
                "github_unavailable",
                "GitHub returned an invalid response. Try publishing again.",
                502,
            ) from exc
        if not isinstance(body, dict):
            raise PublishingError(
                "github_unavailable",
                "GitHub returned an invalid response. Try publishing again.",
                502,
            )
        return body

    @staticmethod
    def _required_string(body: dict[str, Any], key: str) -> str:
        value = body.get(key)
        if not isinstance(value, str) or not value:
            raise PublishingError(
                "github_unavailable",
                "GitHub returned an invalid response. Try publishing again.",
                502,
            )
        return value

    @staticmethod
    def _retry_after(response: httpx.Response) -> int | None:
        raw = response.headers.get("Retry-After")
        try:
            if raw:
                return int(raw)
            reset = response.headers.get("X-RateLimit-Reset")
            return max(0, math.ceil(float(reset) - time.time())) if reset else None
        except ValueError:
            return None

    def _raise_for_response(
        self,
        response: httpx.Response,
        *,
        not_found_code: str = "github_repo_not_found",
        not_found_message: str = "GitHub repository was not found or is not accessible.",
    ) -> None:
        if response.status_code < 400:
            return
        if response.status_code == 401:
            raise PublishingError(
                "github_token_invalid",
                "GitHub rejected the publishing token.",
                400,
            )
        if response.status_code in {403, 429}:
            try:
                error_body = response.json()
                error_message = (
                    str(error_body.get("message", "")).lower()
                    if isinstance(error_body, dict)
                    else ""
                )
            except ValueError:
                error_message = ""
            message_signals_rate_limit = "rate limit" in error_message
            if (
                response.status_code == 429
                or response.headers.get("X-RateLimit-Remaining") == "0"
                or response.headers.get("Retry-After") is not None
                or message_signals_rate_limit
            ):
                raise PublishingError(
                    "github_rate_limited",
                    "GitHub's API rate limit has been reached. Try again later.",
                    429,
                    retry_after=self._retry_after(response) or 60,
                )
            raise PublishingError(
                "github_write_forbidden",
                "The GitHub token cannot write to this repository.",
                403,
            )
        if response.status_code == 404:
            raise PublishingError(not_found_code, not_found_message, 404)
        if response.status_code >= 500:
            raise PublishingError(
                "github_unavailable",
                "GitHub is temporarily unavailable. Try publishing again.",
                503,
            )
        raise PublishingError(
            "github_unavailable",
            "GitHub could not complete the publishing request.",
            502,
        )

    async def get_identity(self) -> str:
        response = await self._send("GET", "/user")
        self._raise_for_response(response)
        return self._required_string(self._json_object(response), "login")

    async def validate_destination(
        self, owner: str, repo: str, branch: str
    ) -> GitHubIdentityAccess:
        login = await self.get_identity()
        repo_response = await self._send("GET", f"/repos/{quote(owner)}/{quote(repo)}")
        self._raise_for_response(repo_response)
        repo_body = self._json_object(repo_response)
        can_push = bool(repo_body.get("permissions", {}).get("push"))
        if not can_push:
            raise PublishingError(
                "github_write_forbidden",
                "The GitHub token can read this repository but cannot write contents.",
                403,
            )
        branch_response = await self._send(
            "GET",
            f"/repos/{quote(owner)}/{quote(repo)}/branches/{quote(branch, safe='')}",
        )
        self._raise_for_response(
            branch_response,
            not_found_code="github_branch_not_found",
            not_found_message=f"Branch '{branch}' was not found.",
        )
        return GitHubIdentityAccess(
            login=login,
            private=bool(repo_body.get("private")),
            can_push=can_push,
        )

    async def get_content(
        self, owner: str, repo: str, branch: str, path: str
    ) -> GitHubContent | None:
        encoded_path = quote(path, safe="/")
        response = await self._send(
            "GET",
            f"/repos/{quote(owner)}/{quote(repo)}/contents/{encoded_path}",
            params={"ref": branch},
        )
        if response.status_code == 404:
            return None
        self._raise_for_response(response)
        body = self._json_object(response)
        return GitHubContent(
            sha=self._required_string(body, "sha"),
            html_url=str(body.get("html_url", "")),
        )

    async def put_content(
        self,
        owner: str,
        repo: str,
        branch: str,
        path: str,
        content: str,
        message: str,
        expected_sha: str | None,
    ) -> GitHubCommitResult:
        payload: dict[str, str] = {
            "message": message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "branch": branch,
        }
        if expected_sha is not None:
            payload["sha"] = expected_sha
        response = await self._send(
            "PUT",
            f"/repos/{quote(owner)}/{quote(repo)}/contents/{quote(path, safe='/')}",
            json=payload,
        )
        if response.status_code in {409, 422}:
            raise PublishingError(
                "publish_conflict",
                "The GitHub file changed after BlogForge last published it.",
                409,
                repository_url=f"https://github.com/{owner}/{repo}",
                path=path,
            )
        self._raise_for_response(response)
        body = self._json_object(response)
        content_body = body.get("content") or {}
        commit_body = body.get("commit") or {}
        if not isinstance(content_body, dict) or not isinstance(commit_body, dict):
            raise PublishingError(
                "github_unavailable",
                "GitHub returned an invalid response. Try publishing again.",
                502,
            )
        return GitHubCommitResult(
            content_sha=self._required_string(content_body, "sha"),
            content_url=str(content_body.get("html_url", "")),
            commit_sha=self._required_string(commit_body, "sha"),
            commit_url=str(commit_body.get("html_url", "")),
        )
