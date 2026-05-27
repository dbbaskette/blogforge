"""Admin user-management endpoints. All require role=admin."""
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from pencraft.auth.dependencies import _get_session, require_admin
from pencraft.db.models import User

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


class UserOut(BaseModel):
    id: str
    email: str
    status: str
    role: str
    created_at: datetime
    approved_at: datetime | None
    last_login_at: datetime | None

    @classmethod
    def from_orm(cls, u: User) -> "UserOut":
        return cls(
            id=str(u.id),
            email=u.email,
            status=u.status,
            role=u.role,
            created_at=u.created_at,
            approved_at=u.approved_at,
            last_login_at=u.last_login_at,
        )


async def _load_user(user_id: UUID, session: AsyncSession) -> User:
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")
    return user


@router.get("/users", response_model=list[UserOut])
async def list_users(
    status: str | None = None,
    session: AsyncSession = Depends(_get_session),
) -> list[UserOut]:
    q = select(User).order_by(User.created_at.desc())
    if status is not None:
        q = q.where(User.status == status)
    rows = (await session.execute(q)).scalars().all()
    return [UserOut.from_orm(u) for u in rows]


@router.post("/users/{user_id}/approve", response_model=UserOut)
async def approve(
    user_id: UUID,
    current: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_session),
) -> UserOut:
    user = await _load_user(user_id, session)
    user.status = "approved"
    user.approved_at = datetime.now(UTC)
    user.approved_by = current.id
    await session.commit()
    return UserOut.from_orm(user)


@router.post("/users/{user_id}/reject", response_model=UserOut)
async def reject(
    user_id: UUID,
    session: AsyncSession = Depends(_get_session),
) -> UserOut:
    user = await _load_user(user_id, session)
    user.status = "rejected"
    await session.commit()
    return UserOut.from_orm(user)


@router.post("/users/{user_id}/disable", response_model=UserOut)
async def disable(
    user_id: UUID,
    session: AsyncSession = Depends(_get_session),
) -> UserOut:
    user = await _load_user(user_id, session)
    user.status = "disabled"
    await session.commit()
    return UserOut.from_orm(user)


@router.post("/users/{user_id}/promote", response_model=UserOut)
async def promote(
    user_id: UUID,
    session: AsyncSession = Depends(_get_session),
) -> UserOut:
    user = await _load_user(user_id, session)
    user.role = "admin"
    await session.commit()
    return UserOut.from_orm(user)
