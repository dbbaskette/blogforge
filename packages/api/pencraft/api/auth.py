"""Auth endpoints: /api/auth/request, /login, /logout, /me."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from pencraft.auth.dependencies import _get_session
from pencraft.auth.passwords import hash_password
from pencraft.db.models import User

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
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="email_already_exists"
        )
    return {"status": "pending"}
