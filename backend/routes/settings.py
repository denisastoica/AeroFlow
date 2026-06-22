from fastapi import APIRouter, Depends
from backend.services.auth_dependencies import require_role
from backend.services.settings_service import get_settings, update_settings

router = APIRouter(prefix="/settings", tags=["Settings"])

@router.get("/")
def api_get_settings():
    return get_settings()

@router.post("/")
def api_update_settings(
    payload: dict,
    _: dict = Depends(require_role("admin", "dispatcher")),
):
    return update_settings(payload)
