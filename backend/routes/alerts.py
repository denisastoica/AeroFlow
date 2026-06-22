"""
Routes for operational alerts.
GET  /alerts         — alert list (filters: severity, alert_type, acknowledged, drone_id, delivery_id)
PATCH /alerts/{id}/acknowledge  — marks alert as seen
DELETE /alerts/{id}  — deletes alert (admin only)
POST /alerts/acknowledge-all    — marks all unseen alerts as seen
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.alert import Alert
from backend.services.auth_dependencies import get_current_user, require_role
from backend.models.user import User

router = APIRouter(prefix="/alerts", tags=["Alerts"])


def _alert_to_dict(a: Alert) -> dict:
    return {
        "id": a.id,
        "alert_type": a.alert_type,
        "severity": a.severity,
        "status": a.status,
        "occurrence_count": a.occurrence_count,
        "message": a.message,
        "details": a.details,
        "drone_id": a.drone_id,
        "delivery_id": a.delivery_id,
        "mission_id": a.mission_id,
        "created_at": a.created_at.replace(tzinfo=timezone.utc).isoformat() if a.created_at else None,
        "updated_at": a.updated_at.replace(tzinfo=timezone.utc).isoformat() if a.updated_at else None,
        "acknowledged_at": a.acknowledged_at.replace(tzinfo=timezone.utc).isoformat() if a.acknowledged_at else None,
        "resolved_at": a.resolved_at.replace(tzinfo=timezone.utc).isoformat() if a.resolved_at else None,
    }


@router.get("/", response_model=list)
def list_alerts(
    severity: Optional[str] = Query(None, description="info | warning | critical"),
    alert_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="new | acknowledged | resolved"),
    drone_id: Optional[int] = Query(None),
    delivery_id: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    _: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    """
    Returns operational alerts, most recent first.
    Accessible: admin, dispatcher.
    """
    q = db.query(Alert)
    if severity:
        q = q.filter(Alert.severity == severity)
    if alert_type:
        q = q.filter(Alert.alert_type == alert_type)
    if status:
        q = q.filter(Alert.status == status)
    if drone_id is not None:
        q = q.filter(Alert.drone_id == drone_id)
    if delivery_id is not None:
        q = q.filter(Alert.delivery_id == delivery_id)

    alerts = q.order_by(Alert.created_at.desc()).limit(limit).all()
    return [_alert_to_dict(a) for a in alerts]


@router.get("/summary", response_model=dict)
def alerts_summary(
    _: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    """
    Returns global summary of alerts.
    Accessible: admin, dispatcher.
    """
    active_alerts = db.query(Alert).filter(Alert.status != "resolved").all()
    resolved_alerts_count = db.query(Alert).filter(Alert.status == "resolved").count()
    
    return {
        "total_active": len(active_alerts),
        "total_new": sum(1 for a in active_alerts if a.status == "new"),
        "total_acknowledged": sum(1 for a in active_alerts if a.status == "acknowledged"),
        "total_resolved": resolved_alerts_count,
        "critical": sum(1 for a in active_alerts if a.severity == "critical"),
        "warning": sum(1 for a in active_alerts if a.severity == "warning"),
        "info": sum(1 for a in active_alerts if a.severity == "info"),
    }


from backend.services.audit_service import log_audit
from backend.services.auth_dependencies import get_current_user, require_role

@router.patch("/{alert_id}/acknowledge", response_model=dict)
def acknowledge_alert(
    alert_id: int,
    user_dict: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    """
    Marks an alert as seen.
    Accessible: admin, dispatcher.
    """
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    if alert.status == "new":
        alert.status = "acknowledged"
        alert.acknowledged_at = datetime.now(timezone.utc)
        

        user = db.query(User).filter(User.id == user_dict["id"]).first()
        log_audit(
            db=db,
            action="ALERT_ACKNOWLEDGED",
            entity_type="alert",
            entity_id=alert.id,
            user=user,
            description=f"Alert #{alert.id} acknowledged by {user.email if user else 'System'}"
        )
        
        db.commit()
        db.refresh(alert)
    
    return {"message": "Acknowledged", "alert": _alert_to_dict(alert)}


@router.patch("/{alert_id}/resolve", response_model=dict)
def resolve_alert(
    alert_id: int,
    user_dict: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    """Marks an alert as resolved."""
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    alert.status = "resolved"
    alert.resolved_at = datetime.now(timezone.utc)
    

    user = db.query(User).filter(User.id == user_dict["id"]).first()
    log_audit(
        db=db,
        action="ALERT_RESOLVED",
        entity_type="alert",
        entity_id=alert.id,
        user=user,
        description=f"Alert #{alert.id} resolved by {user.email if user else 'System'}"
    )
    
    db.commit()
    db.refresh(alert)
    return {"message": "Resolved", "alert": _alert_to_dict(alert)}


@router.post("/acknowledge-similar", response_model=dict)
def acknowledge_similar_alerts(
    alert_id: int,
    user_dict: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    """Acknowledges all new alerts of the same type and for the same drone/delivery."""
    base = db.query(Alert).filter(Alert.id == alert_id).first()
    if not base:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    q = db.query(Alert).filter(
        Alert.status == "new",
        Alert.alert_type == base.alert_type,
        Alert.drone_id == base.drone_id,
        Alert.delivery_id == base.delivery_id
    )
    
    now = datetime.now(timezone.utc)
    count = 0
    for a in q.all():
        a.status = "acknowledged"
        a.acknowledged_at = now
        count += 1
    
    if count > 0:
        user = db.query(User).filter(User.id == user_dict["id"]).first()
        log_audit(
            db=db,
            action="BULK_ALERT_ACKNOWLEDGE",
            entity_type="alert",
            user=user,
            description=f"{count} similar alerts acknowledged by {user.email if user else 'System'}"
        )
    
    db.commit()
    return {"acknowledged": count}

@router.post("/resolve-similar", response_model=dict)
def resolve_similar_alerts(
    alert_id: int,
    user_dict: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    """Resolves all alerts of the same type and for the same drone/delivery."""
    base = db.query(Alert).filter(Alert.id == alert_id).first()
    if not base:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    q = db.query(Alert).filter(
        Alert.status != "resolved",
        Alert.alert_type == base.alert_type,
        Alert.drone_id == base.drone_id,
        Alert.delivery_id == base.delivery_id
    )
    
    now = datetime.now(timezone.utc)
    count = 0
    for a in q.all():
        a.status = "resolved"
        a.resolved_at = now
        count += 1
        
    if count > 0:
        user = db.query(User).filter(User.id == user_dict["id"]).first()
        log_audit(
            db=db,
            action="BULK_ALERT_RESOLVE",
            entity_type="alert",
            user=user,
            description=f"{count} similar alerts resolved by {user.email if user else 'System'}"
        )
    
    db.commit()
    return {"resolved": count}


@router.post("/acknowledge-all", response_model=dict)
def acknowledge_all_alerts(
    severity: Optional[str] = Query(None, description="Marks only alerts with this severity"),
    user_dict: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    """Marks all unseen alerts (optionally filtered by severity) as seen."""
    query = db.query(Alert).filter(Alert.status == "new")
    if severity:
        query = query.filter(Alert.severity == severity)
        
    count = 0
    now = datetime.now(timezone.utc)
    for alert in query.all():
        alert.status = "acknowledged"
        alert.acknowledged_at = now
        count += 1
        
    if count > 0:
        user = db.query(User).filter(User.id == user_dict["id"]).first()
        log_audit(
            db=db,
            action="ACKNOWLEDGE_ALL_ALERTS",
            entity_type="alert",
            user=user,
            description=f"All {count} new alerts{f' with severity {severity}' if severity else ''} were acknowledged globally by {user.email if user else 'System'}"
        )
        
    db.commit()
    return {"acknowledged": count, "message": f"{count} alerts acknowledged"}


@router.delete("/{alert_id}", response_model=dict)
def delete_alert(
    alert_id: int,
    _: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """
    Deletes an alert from the database.
    Accessible: admin only.
    """
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    db.delete(alert)
    db.commit()
    return {"message": f"Alert #{alert_id} deleted"}
