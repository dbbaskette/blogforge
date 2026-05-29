"""FastAPI dependencies: get_current_user, require_admin.

Reads the signed session cookie, loads the user, enforces approval status
and (optionally) role=admin. Raises HTTP 401 for missing/invalid cookies
and 403 for status/role mismatches.
"""
from collections.abc import AsyncIterator

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.config import get_settings
from pencraft.db.engine import get_sessionmaker
from pencraft.db.models import User


async def _get_session() -> AsyncIterator[AsyncSession]:
    sm = get_sessionmaker()
    async with sm() as session:
        yield session


def _get_signer() -> SessionSigner:
    return SessionSigner(get_settings().session_secret)


async def get_current_user(
    pencraft_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    session: AsyncSession = Depends(_get_session),
) -> User:
    """Resolve the currently-signed-in, approved user, or raise."""
    if not pencraft_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not_authenticated")
    unsigned = _get_signer().unsign(pencraft_session)
    if unsigned is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_session")
    user_id, session_version = unsigned
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user_not_found")
    if session_version != user.session_version:
        # Cookie predates a sign-out-everywhere / password change.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="session_revoked")
    if user.status != "approved":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"status_{user.status}")
    return user


async def require_admin(current: User = Depends(get_current_user)) -> User:
    if current.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_required")
    return current
