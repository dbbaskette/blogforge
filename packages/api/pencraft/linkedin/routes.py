"""LinkedIn connector routes. Health for now; OAuth + publish land in later tasks."""
from fastapi import APIRouter

from pencraft import __version__

router = APIRouter(prefix="/linkedin", tags=["linkedin"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}
