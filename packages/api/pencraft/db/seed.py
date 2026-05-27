"""Seed the configured admin user. Called from the FastAPI lifespan event."""
from datetime import datetime, UTC

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from pencraft.auth.passwords import hash_password
from pencraft.db.models import User


async def ensure_admin_user(session: AsyncSession, *, email: str, password: str) -> User:
    """Create the admin user if it doesn't exist. No-op otherwise."""
    canonical_email = email.strip().lower()
    existing = (
        await session.execute(select(User).where(User.email == canonical_email))
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    user = User(
        email=canonical_email,
        password_hash=hash_password(password),
        status="approved",
        role="admin",
        approved_at=datetime.now(UTC),
    )
    session.add(user)
    await session.flush()
    return user
