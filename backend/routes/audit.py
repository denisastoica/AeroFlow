"""
Routes for Audit Log — viewing and querying system activity.
Accessible only to admins.
"""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator
from typing import Optional
import json

from backend.database import get_db
from backend.models.user import User
from backend.models.audit_log import AuditLog, AuditAction, AuditEntityType
from backend.services.audit_service import (
    get_audit_logs,
    get_entity_history,
    get_user_activity,
    get_override_actions,
    get_recent_activity,
    get_activity_summary,
)
from backend.services.auth_dependencies import get_current_user, require_role

router = APIRouter(prefix="/audit", tags=["Audit"])


class AuditLogResponse(BaseModel):
    id: int
    user_id: Optional[int]
    user_email: Optional[str]
    user_role: Optional[str]
    entity_type: str
    entity_id: Optional[int]
    action: str
    description: Optional[str]
    old_value: Optional[dict] = None
    new_value: Optional[dict] = None
    metadata: Optional[dict] = None
    ip_address: Optional[str]
    created_at: datetime

    @field_validator('created_at', mode='after')
    @classmethod
    def ensure_utc(cls, v: datetime) -> datetime:
        if v and v.tzinfo is None:
            from datetime import timezone
            return v.replace(tzinfo=timezone.utc)
        return v
    
    @classmethod
    def from_orm_with_json(cls, log: AuditLog) -> "AuditLogResponse":
        """Converts AuditLog to response, parsing JSON fields."""
        return cls(
            id=log.id,
            user_id=log.user_id,
            user_email=log.user_email,
            user_role=log.user_role,
            entity_type=log.entity_type,
            entity_id=log.entity_id,
            action=log.action,
            description=log.description,
            old_value=json.loads(log.old_value) if log.old_value else None,
            new_value=json.loads(log.new_value) if log.new_value else None,
            metadata=json.loads(log.extra_data) if log.extra_data else None,
            ip_address=log.ip_address,
            created_at=log.created_at,
        )


class PaginatedAuditResponse(BaseModel):
    items: list[AuditLogResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_prev: bool


class ActivitySummaryResponse(BaseModel):
    date_from: str
    date_to: str
    total_actions: int
    system_actions: int
    user_actions: int
    security_actions: int
    actions_by_type: dict
    actions_by_entity: dict
    top_users: list[dict]


@router.get("/logs", response_model=PaginatedAuditResponse)
def list_audit_logs(
    entity_type: str = Query(None, description="Entity type filter: delivery, mission, drone, user, system"),
    entity_id: int = Query(None, description="Entity ID filter"),
    user_id: int = Query(None, description="User ID filter (who performed the action)"),
    action: str = Query(None, description="Exact action filter"),
    action_prefix: str = Query(None, description="Action prefix filter (e.g. DELIVERY_ for all delivery actions)"),
    date_from: datetime = Query(None, description="Start date (ISO format)"),
    date_to: datetime = Query(None, description="End date (ISO format)"),
    overrides_only: bool = Query(False, description="Only manual override actions"),
    system_only: bool = Query(False, description="Only system automation events (user_id is null)"),
    user_only: bool = Query(False, description="Only standard user actions"),
    security_only: bool = Query(False, description="Only security-related actions (login, override)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    payload: dict = Depends(require_role("admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Lists the audit log with filters.
    
    Available filters:
    - entity_type: delivery, mission, drone, user, system
    - entity_id: specific entity ID
    - user_id: who performed the action
    - action: exact action type
    - action_prefix: prefix for filtering (e.g. DELIVERY_)
    - date_from/date_to: time interval
    - overrides_only: only manual override actions
    - system_only: only system automation events
    - user_only: only normal user actions
    - security_only: only security events
    
    Accessible: admin
    """

    actions = None
    if overrides_only:
        actions = [
            AuditAction.OVERRIDE_MANUAL_REASSIGN,
            AuditAction.OVERRIDE_FORCE_CANCEL,
            AuditAction.OVERRIDE_MANUAL_FAIL,
            AuditAction.OVERRIDE_MANUAL_PAUSE,
            AuditAction.OVERRIDE_MANUAL_RESUME,
            AuditAction.OVERRIDE_SEND_TO_CHARGE,
        ]
    elif action_prefix:

        all_actions = [
            getattr(AuditAction, attr) for attr in dir(AuditAction)
            if not attr.startswith("_") and attr.startswith(action_prefix.upper())
        ]
        if all_actions:
            actions = all_actions
    
    offset = (page - 1) * page_size
    
    logs, total = get_audit_logs(
        db=db,
        entity_type=entity_type,
        entity_id=entity_id,
        user_id=user_id,
        action=action,
        actions=actions,
        date_from=date_from,
        date_to=date_to,
        system_only=system_only,
        user_only=user_only,
        security_only=security_only,
        limit=page_size,
        offset=offset,
    )
    
    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    
    return PaginatedAuditResponse(
        items=[AuditLogResponse.from_orm_with_json(log) for log in logs],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        has_next=page < total_pages,
        has_prev=page > 1,
    )


@router.get("/entity/{entity_type}/{entity_id}", response_model=list[AuditLogResponse])
def get_entity_audit_history(
    entity_type: str,
    entity_id: int,
    payload: dict = Depends(require_role("admin", "dispatcher")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Gets the complete history of an entity.
    
    Examples:
    - GET /audit/entity/delivery/123 — history for delivery #123
    - GET /audit/entity/drone/5 — history for drone #5
    
    Accessible: admin, dispatcher
    """
    if entity_type not in ["delivery", "mission", "drone", "user", "system", "alert"]:
        raise HTTPException(status_code=400, detail="Invalid entity type")
    
    logs = get_entity_history(db, entity_type, entity_id)
    
    return [AuditLogResponse.from_orm_with_json(log) for log in logs]


@router.get("/user/{user_id}/activity", response_model=list[AuditLogResponse])
def get_user_audit_activity(
    user_id: int,
    limit: int = Query(50, ge=1, le=200),
    payload: dict = Depends(require_role("admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Gets recent activity for a user.
    Accessible: admin
    """
    logs = get_user_activity(db, user_id, limit)
    
    return [AuditLogResponse.from_orm_with_json(log) for log in logs]


@router.get("/overrides", response_model=list[AuditLogResponse])
def list_override_actions(
    date_from: datetime = Query(None, description="Start date (ISO format)"),
    limit: int = Query(100, ge=1, le=500),
    payload: dict = Depends(require_role("admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Lists all manual override actions.
    Important for compliance audit and investigations.
    
    Includes:
    - Manual reassignments
    - Force cancellations
    - Manual fails
    - Manual Pause/Resume
    - Forced send to charge
    
    Accessible: admin
    """
    logs = get_override_actions(db, date_from, limit)
    
    return [AuditLogResponse.from_orm_with_json(log) for log in logs]


@router.get("/recent", response_model=list[AuditLogResponse])
def list_recent_activity(
    limit: int = Query(50, ge=1, le=200),
    payload: dict = Depends(require_role("admin", "dispatcher")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Gets recent system activity.
    Accessible: admin, dispatcher
    """
    logs = get_recent_activity(db, limit)
    
    return [AuditLogResponse.from_orm_with_json(log) for log in logs]


@router.get("/summary", response_model=ActivitySummaryResponse)
def get_audit_summary(
    date_from: datetime = Query(None, description="Start date (default: last 7 days)"),
    date_to: datetime = Query(None, description="End date (default: now)"),
    payload: dict = Depends(require_role("admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Gets an activity summary for a time interval.
    
    Includes:
    - Total actions
    - Distribution by action type
    - Distribution by entity type
    - Top active users
    
    Accessible: admin
    """
    if not date_from:
        date_from = datetime.now(timezone.utc) - timedelta(days=7)
    if not date_to:
        date_to = datetime.now(timezone.utc)
    
    summary = get_activity_summary(db, date_from, date_to)
    
    return ActivitySummaryResponse(**summary)


@router.get("/actions/types")
def list_action_types(
    payload: dict = Depends(require_role("admin", "dispatcher")),
    current_user: User = Depends(get_current_user),
):
    """
    Returns all action types available for filtering.
    Accessible: admin, dispatcher
    """
    actions = {
        attr: getattr(AuditAction, attr)
        for attr in dir(AuditAction)
        if not attr.startswith("_")
    }
    

    categories = {
        "delivery": [a for a in actions.values() if a.startswith("DELIVERY_")],
        "mission": [a for a in actions.values() if a.startswith("MISSION_")],
        "drone": [a for a in actions.values() if a.startswith("DRONE_")],
        "user": [a for a in actions.values() if a.startswith("USER_")],
        "system": [a for a in actions.values() if a.startswith("SYSTEM_")],
        "override": [a for a in actions.values() if a.startswith("OVERRIDE_")],
    }
    
    return {
        "all_actions": list(actions.values()),
        "categories": categories,
        "entity_types": ["delivery", "mission", "drone", "user", "system", "alert", "no_fly_zone"],
    }
@router.get("/export/csv")
def export_audit_logs(
    entity_type: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    payload: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """
    Exports the audit log as a CSV file.
    Accessible: admin
    """
    import csv
    import io
    from fastapi.responses import StreamingResponse

    logs, _ = get_audit_logs(
        db=db,
        entity_type=entity_type,
        date_from=date_from,
        date_to=date_to,
        limit=2000,
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Timestamp", "User Email", "Role", "Entity", "Entity ID", "Action", "Description", "IP"])

    for log in logs:
        writer.writerow([
            log.id,
            log.created_at.isoformat(),
            log.user_email or "SYSTEM",
            log.user_role or "N/A",
            log.entity_type,
            log.entity_id or "N/A",
            log.action,
            log.description,
            log.ip_address or "N/A"
        ])

    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    filename = f"audit_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    response.headers["Content-Disposition"] = f"attachment; filename={filename}"
    return response
