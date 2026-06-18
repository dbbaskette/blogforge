"""GitHub identity -> BlogForge user: allowlist gate + upsert + admin adoption."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from blogforge.config import get_settings
from blogforge.db.models import User


@dataclass(frozen=True)
class GithubIdentity:
    id: int
    login: str
    email: str | None
    avatar_url: str | None


def is_allowlisted(login: str) -> bool:
    return login.lower() in get_settings().github_allowlist


async def resolve_github_user(session: AsyncSession, ident: GithubIdentity) -> User | None:
    """Return the BlogForge user for a GitHub identity, or None if not allowed.

    1) match by github_id, 2) reject if not allowlisted, 3) adopt the existing
    admin row for the admin login, else link-by-email or create a new user.
    Denials (not allowlisted, disabled/rejected, or a row already bound to a
    different GitHub identity) return None WITHOUT side effects.
    """
    settings = get_settings()
    now = datetime.now(UTC)

    existing = (
        await session.execute(select(User).where(User.github_id == ident.id))
    ).scalar_one_or_none()
    if existing is not None:
        if existing.status in ("disabled", "rejected"):
            return None
        existing.github_login = ident.login
        existing.avatar_url = ident.avatar_url
        existing.last_login_at = now
        await session.commit()
        return existing

    if not is_allowlisted(ident.login):
        return None

    user: User | None = None
    if settings.github_admin_login and ident.login.lower() == settings.github_admin_login.lower():
        user = (
            await session.execute(select(User).where(User.role == "admin").limit(1))
        ).scalar_one_or_none()
        if user is None and settings.admin_email:
            user = (
                await session.execute(select(User).where(User.email == settings.admin_email))
            ).scalar_one_or_none()
        role = "admin"
    else:
        role = "user"

    if user is None and ident.email:
        user = (
            await session.execute(select(User).where(User.email == ident.email.lower()))
        ).scalar_one_or_none()

    # Never rebind a row already tied to a different GitHub identity, and never
    # revive a disabled/rejected row — both deny without side effects.
    if user is not None:
        if user.github_id is not None and user.github_id != ident.id:
            return None
        if user.status in ("disabled", "rejected"):
            return None

    if user is None:
        user = User(
            email=(ident.email.lower() if ident.email else None),
            status="approved",
            role=role,
        )
        session.add(user)

    user.github_id = ident.id
    user.github_login = ident.login
    user.avatar_url = ident.avatar_url
    user.role = role
    user.status = "approved"
    user.last_login_at = now
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        return None
    return user
