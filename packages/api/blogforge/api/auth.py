"""Auth endpoints: /logout, /me, /sessions/revoke-all."""
from datetime import datetime

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from blogforge.auth.dependencies import _get_session, get_current_user
from blogforge.auth.sessions import COOKIE_NAME
from blogforge.db.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class MeResponse(BaseModel):
    id: str
    email: str | None = None
    github_login: str | None = None
    avatar_url: str | None = None
    role: str
    status: str
    last_login_at: datetime | None = None


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
        github_login=current.github_login,
        avatar_url=current.avatar_url,
        role=current.role,
        status=current.status,
        last_login_at=current.last_login_at,
    )


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
