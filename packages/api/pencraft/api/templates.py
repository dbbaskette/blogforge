"""CRUD for reusable draft templates. All routes are user-scoped."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from pencraft.auth.dependencies import get_current_user
from pencraft.db.models import User
from pencraft.templates.models import Template, TemplateFromDraft, TemplateInput
from pencraft.templates.store import TemplateStore

router = APIRouter(tags=["templates"])


@router.get("/api/templates")
async def list_templates(
    request: Request,
    current: User = Depends(get_current_user),
) -> list[Template]:
    store: TemplateStore = request.app.state.template_store
    return await store.list_for_user(current.id)


@router.post("/api/templates", status_code=201)
async def create_template(
    body: TemplateInput,
    request: Request,
    current: User = Depends(get_current_user),
) -> Template:
    store: TemplateStore = request.app.state.template_store
    return await store.create(user_id=current.id, data=body)


@router.post("/api/templates/from-draft/{draft_id}", status_code=201)
async def create_template_from_draft(
    draft_id: str,
    body: TemplateFromDraft,
    request: Request,
    current: User = Depends(get_current_user),
) -> Template:
    store: TemplateStore = request.app.state.template_store
    tmpl = await store.create_from_draft(draft_id, user_id=current.id, name=body.name)
    if tmpl is None:
        raise HTTPException(
            404, detail={"error": {"code": "draft_not_found", "message": draft_id}}
        )
    return tmpl


@router.delete("/api/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Response:
    store: TemplateStore = request.app.state.template_store
    deleted = await store.delete(template_id, user_id=current.id)
    if not deleted:
        raise HTTPException(
            404, detail={"error": {"code": "template_not_found", "message": template_id}}
        )
    return Response(status_code=204)
