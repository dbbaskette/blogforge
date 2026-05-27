"""SQLAlchemy declarative base.

Kept in its own module so Alembic's env.py can import without pulling in
the whole engine machinery (matters for `alembic check` in CI).
"""
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for all Pencraft ORM models."""
