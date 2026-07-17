"""Authenticated per-user GitHub publishing configuration endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.publishing.github_client import GitHubPublisherClient, PublishingError
from blogforge.publishing.models import PublishingPreset, PublishingSettings
from blogforge.publishing.service import PublishResult, publish_draft_to_github
from blogforge.publishing.settings_store import PublishingSettingsStore
from blogforge.publishing.token_vault import PublishingTokenVault

router = APIRouter(prefix="/api/publishing", tags=["publishing"])
draft_router = APIRouter(prefix="/api/drafts", tags=["publishing"])


class PublishingSettingsBody(BaseModel):
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    branch: str = Field(default="main", min_length=1, max_length=256)
    content_dir: str = Field(default="content/posts", max_length=512)
    frontmatter_preset: PublishingPreset = "hugo"


class PublishingSettingsResponse(BaseModel):
    configured: bool
    owner: str
    repo: str
    branch: str
    content_dir: str
    frontmatter_preset: PublishingPreset
    token_set: bool
    validated_login: str | None = None
    ready: bool = False


class PublishingTokenBody(BaseModel):
    token: str = Field(min_length=1)


class PublishingTokenResponse(BaseModel):
    token_set: bool
    login: str


class PublishingValidationResponse(BaseModel):
    ready: bool
    validated_login: str
    private: bool


def _error(code: str, message: str, status_code: int) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"error": {"code": code, "message": message}},
    )


def _github_error(exc: PublishingError) -> HTTPException:
    error: dict[str, object] = {"code": exc.code, "message": str(exc)}
    if exc.retry_after is not None:
        error["retry_after"] = exc.retry_after
    if exc.repository_url is not None:
        error["repository_url"] = exc.repository_url
    if exc.path is not None:
        error["path"] = exc.path
    return HTTPException(status_code=exc.status_code, detail={"error": error})


async def _response_for(user_id, settings: PublishingSettings | None) -> PublishingSettingsResponse:
    token_set = await PublishingTokenVault(user_id).is_set()
    validation = await PublishingSettingsStore().validation(user_id)
    if settings is None:
        return PublishingSettingsResponse(
            configured=False,
            owner="",
            repo="",
            branch="main",
            content_dir="content/posts",
            frontmatter_preset="hugo",
            token_set=token_set,
        )
    return PublishingSettingsResponse(
        configured=True,
        **settings.model_dump(),
        token_set=token_set,
        validated_login=validation.login,
        ready=bool(token_set and validation.login and validation.validated_at),
    )


@router.get("/settings", response_model=PublishingSettingsResponse)
async def get_publishing_settings(
    current: User = Depends(get_current_user),
) -> PublishingSettingsResponse:
    settings = await PublishingSettingsStore().get(current.id)
    return await _response_for(current.id, settings)


@router.put("/settings", response_model=PublishingSettingsResponse)
async def put_publishing_settings(
    body: PublishingSettingsBody,
    current: User = Depends(get_current_user),
) -> PublishingSettingsResponse:
    try:
        settings = await PublishingSettingsStore().save(
            current.id, PublishingSettings.model_validate(body.model_dump())
        )
    except ValueError as exc:
        code = "invalid_content_dir" if "folder" in str(exc).lower() else "invalid_settings"
        raise _error(code, str(exc), 400) from exc
    return await _response_for(current.id, settings)


@router.put("/token", response_model=PublishingTokenResponse)
async def put_publishing_token(
    body: PublishingTokenBody,
    current: User = Depends(get_current_user),
) -> PublishingTokenResponse:
    cleaned = body.token.strip()
    if not cleaned:
        raise _error("github_token_empty", "GitHub token must not be empty.", 400)
    try:
        login = await GitHubPublisherClient(cleaned).get_identity()
    except PublishingError as exc:
        raise _github_error(exc) from exc
    await PublishingTokenVault(current.id).set(cleaned)
    await PublishingSettingsStore().clear_validation(current.id)
    return PublishingTokenResponse(token_set=True, login=login)


@router.delete("/token", status_code=status.HTTP_204_NO_CONTENT)
async def delete_publishing_token(
    current: User = Depends(get_current_user),
) -> Response:
    await PublishingTokenVault(current.id).delete()
    await PublishingSettingsStore().clear_validation(current.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/validate", response_model=PublishingValidationResponse)
async def validate_publishing_destination(
    current: User = Depends(get_current_user),
) -> PublishingValidationResponse:
    settings = await PublishingSettingsStore().get(current.id)
    if settings is None:
        raise _error(
            "github_settings_missing",
            "Configure a GitHub publishing destination first.",
            400,
        )
    token = await PublishingTokenVault(current.id).get()
    if not token:
        raise _error("github_token_missing", "Add a GitHub publishing token first.", 400)
    try:
        access = await GitHubPublisherClient(token).validate_destination(
            settings.owner, settings.repo, settings.branch
        )
    except PublishingError as exc:
        raise _github_error(exc) from exc
    await PublishingSettingsStore().record_validation(current.id, access.login)
    return PublishingValidationResponse(
        ready=True,
        validated_login=access.login,
        private=access.private,
    )


@draft_router.post("/{draft_id}/publish/github", response_model=PublishResult)
async def publish_draft(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> PublishResult:
    try:
        return await publish_draft_to_github(draft_id, current.id, request.app.state.draft_store)
    except PublishingError as exc:
        raise _github_error(exc) from exc
