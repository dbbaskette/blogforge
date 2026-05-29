"""Auth endpoints: /api/auth/request, /login, /logout, /me."""
from datetime import UTC, datetime
from typing import Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from blogforge.auth.dependencies import _get_session, _get_signer, get_current_user
from blogforge.auth.passwords import hash_password, verify_password
from blogforge.auth.sessions import COOKIE_MAX_AGE_SECONDS, COOKIE_NAME
from blogforge.config import get_settings
from blogforge.db.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RequestAccessBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class MeResponse(BaseModel):
    id: str
    email: str
    role: str
    status: str
    last_login_at: datetime | None = None


class ChangePasswordBody(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8, max_length=200)


@router.post("/request", status_code=status.HTTP_201_CREATED)
async def request_access(
    body: RequestAccessBody,
    session: AsyncSession = Depends(_get_session),
) -> dict[str, str]:
    """Create a pending user row. Admin must approve before they can log in."""
    canonical = body.email.lower()
    user = User(
        email=canonical,
        password_hash=hash_password(body.password),
        status="pending",
        role="user",
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as err:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="email_already_exists"
        ) from err
    return {"status": "pending"}


@router.post("/login")
async def login(
    body: LoginBody,
    response: Response,
    session: AsyncSession = Depends(_get_session),
) -> dict[str, str]:
    """Verify credentials, set session cookie, return ok."""
    canonical = body.email.lower()
    user = (
        await session.execute(select(User).where(User.email == canonical))
    ).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials")
    if user.status != "approved":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"status_{user.status}")

    user.last_login_at = datetime.now(UTC)
    await session.commit()

    settings = get_settings()
    cookie = _get_signer().sign(user.id, user.session_version)
    response.set_cookie(
        key=COOKIE_NAME,
        value=cookie,
        max_age=COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=cast(Literal["lax", "strict", "none"], settings.cookie_samesite),
        path="/",
    )
    return {"status": "ok"}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> Response:
    response.delete_cookie(COOKIE_NAME, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=MeResponse)
async def me(current: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(
        id=str(current.id),
        email=current.email,
        role=current.role,
        status=current.status,
        last_login_at=current.last_login_at,
    )


@router.post("/change-password")
async def change_password(
    body: ChangePasswordBody,
    response: Response,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(_get_session),
) -> dict[str, str]:
    """Verify the old password, set the new hash, and bump session_version
    so every *other* session is signed out. Re-issues this session's cookie
    at the new version so the caller stays logged in."""
    db_user = (
        await session.execute(select(User).where(User.id == current.id))
    ).scalar_one()
    if not verify_password(body.old_password, db_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_old_password"
        )
    db_user.password_hash = hash_password(body.new_password)
    db_user.session_version += 1
    await session.commit()

    settings = get_settings()
    response.set_cookie(
        key=COOKIE_NAME,
        value=_get_signer().sign(db_user.id, db_user.session_version),
        max_age=COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=cast(Literal["lax", "strict", "none"], settings.cookie_samesite),
        path="/",
    )
    return {"status": "ok"}


@router.post("/sessions/revoke-all", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_all_sessions(
    response: Response,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(_get_session),
) -> Response:
    """Bump session_version — every existing cookie (including this one)
    stops validating, forcing a fresh login everywhere."""
    db_user = (
        await session.execute(select(User).where(User.id == current.id))
    ).scalar_one()
    db_user.session_version += 1
    await session.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
