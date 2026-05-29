"""Admin user is seeded once, idempotently."""
from sqlalchemy import select

from blogforge.auth.passwords import verify_password
from blogforge.db.models import User
from blogforge.db.seed import ensure_admin_user


async def test_creates_admin_on_first_call(session):
    await ensure_admin_user(session, email="root@example.com", password="hunter2")
    user = (
        await session.execute(select(User).where(User.email == "root@example.com"))
    ).scalar_one()
    assert user.role == "admin"
    assert user.status == "approved"
    assert verify_password("hunter2", user.password_hash)


async def test_second_call_is_noop(session):
    await ensure_admin_user(session, email="root@example.com", password="hunter2")
    await ensure_admin_user(session, email="root@example.com", password="different-pw")
    # second call must NOT overwrite the password
    user = (
        await session.execute(select(User).where(User.email == "root@example.com"))
    ).scalar_one()
    assert verify_password("hunter2", user.password_hash)
    assert not verify_password("different-pw", user.password_hash)


async def test_lowercases_email_for_uniqueness(session):
    await ensure_admin_user(session, email="ROOT@Example.com", password="hunter2")
    user = (await session.execute(select(User))).scalar_one()
    assert user.email == "root@example.com"
