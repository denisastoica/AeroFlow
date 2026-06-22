"""
Audit Logging Service — records and queries system activity.
"""
import json
from datetime import datetime, timezone
from typing import Optional, Any
from sqlalchemy.orm import Session

from backend.models.audit_log import AuditLog, AuditAction, AuditEntityType
from backend.models.user import User


def log_audit(
    db: Session,
    action: str,
    entity_type: str,
    entity_id: Optional[int] = None,
    user: Optional[User] = None,
    description: Optional[str] = None,
    old_value: Any = None,
    new_value: Any = None,
    metadata: Optional[dict] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> AuditLog:
    """
    Records an action in the audit log.
    
    Args:
        db: Database session
        action: Action type (from AuditAction)
        entity_type: Affected entity type (from AuditEntityType)
        entity_id: Affected entity ID
        user: User who performed the action
        description: Human-readable description
        old_value: Previous value (will be serialized as JSON)
        new_value: New value (will be serialized as JSON)
        metadata: Additional data
        ip_address: Client IP
        user_agent: Client User-Agent
    
    Returns:
        AuditLog: Created entry
    """
    audit_entry = AuditLog(
        user_id=user.id if user else None,
        user_email=user.email if user else None,
        user_role=user.role if user else None,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        description=description,
        old_value=json.dumps(old_value) if old_value is not None else None,
        new_value=json.dumps(new_value) if new_value is not None else None,
        extra_data=json.dumps(metadata) if metadata else None,
        ip_address=ip_address,
        user_agent=user_agent,
        created_at=datetime.now(timezone.utc),
    )
    
    db.add(audit_entry)
    db.commit()
    db.refresh(audit_entry)
    
    return audit_entry


def log_audit_async(
    db: Session,
    action: str,
    entity_type: str,
    entity_id: Optional[int] = None,
    user: Optional[User] = None,
    description: Optional[str] = None,
    old_value: Any = None,
    new_value: Any = None,
    metadata: Optional[dict] = None,
) -> AuditLog:
    """
    No-commit version — for batch operations or external transactions.
    Caller must commit.
    """
    audit_entry = AuditLog(
        user_id=user.id if user else None,
        user_email=user.email if user else None,
        user_role=user.role if user else None,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        description=description,
        old_value=json.dumps(old_value) if old_value is not None else None,
        new_value=json.dumps(new_value) if new_value is not None else None,
        extra_data=json.dumps(metadata) if metadata else None,
        created_at=datetime.now(timezone.utc),
    )
    
    db.add(audit_entry)
    return audit_entry


def log_delivery_created(db: Session, delivery, user: User) -> AuditLog:
    """Records delivery creation."""
    return log_audit(
        db=db,
        action=AuditAction.DELIVERY_CREATED,
        entity_type=AuditEntityType.DELIVERY,
        entity_id=delivery.id,
        user=user,
        description=f"Delivery #{delivery.id} created by {user.email}",
        new_value={
            "pickup": f"{delivery.pickup_lat}, {delivery.pickup_lon}",
            "dest": f"{delivery.dest_lat}, {delivery.dest_lon}",
            "priority": delivery.priority,
            "package_type": delivery.package_type,
            "weight_kg": delivery.weight_kg,
        },
    )


def log_delivery_assigned(db: Session, delivery, drone, user: Optional[User] = None) -> AuditLog:
    """Records delivery assignment to a drone."""
    return log_audit(
        db=db,
        action=AuditAction.DELIVERY_ASSIGNED,
        entity_type=AuditEntityType.DELIVERY,
        entity_id=delivery.id,
        user=user,
        description=f"Delivery #{delivery.id} assigned to drone {drone.name}",
        new_value={"drone_id": drone.id, "drone_name": drone.name},
        metadata={"auto_assigned": user is None},
    )


def log_delivery_reassigned(
    db: Session,
    delivery,
    old_drone,
    new_drone,
    user: User,
    reason: Optional[str] = None
) -> AuditLog:
    """Records manual delivery reassignment."""
    return log_audit(
        db=db,
        action=AuditAction.OVERRIDE_MANUAL_REASSIGN,
        entity_type=AuditEntityType.DELIVERY,
        entity_id=delivery.id,
        user=user,
        description=f"Delivery #{delivery.id} reassigned by {user.email} from {old_drone.name if old_drone else 'N/A'} to {new_drone.name}",
        old_value={"drone_id": old_drone.id if old_drone else None, "drone_name": old_drone.name if old_drone else None},
        new_value={"drone_id": new_drone.id, "drone_name": new_drone.name},
        metadata={"reason": reason} if reason else None,
    )


def log_delivery_cancelled(db: Session, delivery, user: User, force: bool = False, reason: Optional[str] = None) -> AuditLog:
    """Records delivery cancellation."""
    action = AuditAction.OVERRIDE_FORCE_CANCEL if force else AuditAction.DELIVERY_CANCELLED
    return log_audit(
        db=db,
        action=action,
        entity_type=AuditEntityType.DELIVERY,
        entity_id=delivery.id,
        user=user,
        description=f"Delivery #{delivery.id} {'force ' if force else ''}cancelled by {user.email}",
        old_value={"status": delivery.status, "drone_id": delivery.drone_id},
        new_value={"status": "cancelled"},
        metadata={"reason": reason, "force": force},
    )


def log_delivery_status_change(
    db: Session,
    delivery,
    old_status: str,
    new_status: str,
    user: Optional[User] = None,
    reason: Optional[str] = None
) -> AuditLog:
    """Records delivery status change."""
    return log_audit(
        db=db,
        action=AuditAction.DELIVERY_STATUS_CHANGED,
        entity_type=AuditEntityType.DELIVERY,
        entity_id=delivery.id,
        user=user,
        description=f"Delivery #{delivery.id}: {old_status} → {new_status}",
        old_value={"status": old_status},
        new_value={"status": new_status},
        metadata={"reason": reason, "triggered_by": "user" if user else "system"},
    )


def log_delivery_confirmed(db: Session, delivery, recipient_name: str) -> AuditLog:
    """Records PoD confirmation of a delivery."""
    return log_audit(
        db=db,
        action=AuditAction.DELIVERY_CONFIRMED,
        entity_type=AuditEntityType.DELIVERY,
        entity_id=delivery.id,
        user=None,
        description=f"Delivery #{delivery.id} confirmed by {recipient_name}",
        new_value={
            "recipient_name": recipient_name,
            "confirmed_at": delivery.confirmed_at.isoformat() if delivery.confirmed_at else None,
        },
    )


def log_mission_action(
    db: Session,
    action: str,
    mission,
    user: Optional[User] = None,
    description: Optional[str] = None,
    old_value: Any = None,
    new_value: Any = None,
    reason: Optional[str] = None,
) -> AuditLog:
    """Records a mission action."""
    return log_audit(
        db=db,
        action=action,
        entity_type=AuditEntityType.MISSION,
        entity_id=mission.id,
        user=user,
        description=description or f"Mission #{mission.id}: {action}",
        old_value=old_value,
        new_value=new_value,
        metadata={"reason": reason} if reason else None,
    )


def log_drone_action(
    db: Session,
    action: str,
    drone,
    user: Optional[User] = None,
    description: Optional[str] = None,
    old_value: Any = None,
    new_value: Any = None,
) -> AuditLog:
    """Records a drone action."""
    return log_audit(
        db=db,
        action=action,
        entity_type=AuditEntityType.DRONE,
        entity_id=drone.id,
        user=user,
        description=description or f"Drone {drone.name}: {action}",
        old_value=old_value,
        new_value=new_value,
    )


def log_user_login(db: Session, user: User, ip_address: Optional[str] = None, user_agent: Optional[str] = None) -> AuditLog:
    """Records user login."""
    return log_audit(
        db=db,
        action=AuditAction.USER_LOGIN,
        entity_type=AuditEntityType.USER,
        entity_id=user.id,
        user=user,
        description=f"User {user.email} logged in",
        ip_address=ip_address,
        user_agent=user_agent,
    )


def log_user_logout(db: Session, user: User, ip_address: Optional[str] = None, user_agent: Optional[str] = None) -> AuditLog:
    """Records user logout."""
    return log_audit(
        db=db,
        action=AuditAction.USER_LOGOUT,
        entity_type=AuditEntityType.USER,
        entity_id=user.id,
        user=user,
        description=f"User {user.email} logged out",
        ip_address=ip_address,
        user_agent=user_agent,
    )


def log_user_login_failed(db: Session, email: str, reason: str, ip_address: Optional[str] = None, user_agent: Optional[str] = None) -> AuditLog:
    """Records failed user login."""
    return log_audit(
        db=db,
        action=AuditAction.USER_LOGIN_FAILED,
        entity_type=AuditEntityType.USER,
        entity_id=None,
        user=None,
        description=f"Failed login attempt for {email}: {reason}",
        metadata={"email": email, "reason": reason},
        ip_address=ip_address,
        user_agent=user_agent,
    )


def log_unauthorized_access(db: Session, path: str, reason: str, email: Optional[str] = None, ip_address: Optional[str] = None, user_agent: Optional[str] = None) -> AuditLog:
    """Records unauthorized access attempt."""
    return log_audit(
        db=db,
        action=AuditAction.USER_UNAUTHORIZED_ACCESS,
        entity_type=AuditEntityType.SYSTEM,
        entity_id=None,
        user=None,
        description=f"Unauthorized access to {path}: {reason}",
        metadata={"path": path, "email": email, "reason": reason},
        ip_address=ip_address,
        user_agent=user_agent,
    )


def log_system_event(db: Session, action: str, description: str, metadata: Optional[dict] = None) -> AuditLog:
    """Records a system event."""
    return log_audit(
        db=db,
        action=action,
        entity_type=AuditEntityType.SYSTEM,
        entity_id=None,
        user=None,
        description=description,
        metadata=metadata,
    )


def get_audit_logs(
    db: Session,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    user_id: Optional[int] = None,
    action: Optional[str] = None,
    actions: Optional[list[str]] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    system_only: bool = False,
    user_only: bool = False,
    security_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[AuditLog], int]:
    """
    Retrieves audit logs with filtering and pagination.
    Returns (logs_list, total_count).
    """
    query = db.query(AuditLog)
    
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(AuditLog.entity_id == entity_id)
    if user_id is not None:
        query = query.filter(AuditLog.user_id == user_id)
    
    if system_only:
        query = query.filter(AuditLog.user_id.is_(None))
    elif user_only:
        query = query.filter(
            AuditLog.user_id.isnot(None),
            ~AuditLog.action.ilike("%OVERRIDE%"),
            ~AuditLog.action.ilike("%LOGIN%"),
            ~AuditLog.action.ilike("%DELETE%")
        )
    elif security_only:
        query = query.filter(
            AuditLog.action.ilike("%OVERRIDE%") | AuditLog.action.ilike("%LOGIN%") | AuditLog.action.ilike("%DELETE%")
        )
        
    if action:
        query = query.filter(AuditLog.action == action)
    if actions:
        query = query.filter(AuditLog.action.in_(actions))
    if date_from:
        query = query.filter(AuditLog.created_at >= date_from)
    if date_to:
        query = query.filter(AuditLog.created_at <= date_to)
    
    total = query.count()
    
    logs = query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()
    
    return logs, total


def get_entity_history(db: Session, entity_type: str, entity_id: int) -> list[AuditLog]:
    """Gets full history of an entity."""
    return db.query(AuditLog).filter(
        AuditLog.entity_type == entity_type,
        AuditLog.entity_id == entity_id
    ).order_by(AuditLog.created_at.asc()).all()


def get_user_activity(db: Session, user_id: int, limit: int = 50) -> list[AuditLog]:
    """Gets recent activity of a user."""
    return db.query(AuditLog).filter(
        AuditLog.user_id == user_id
    ).order_by(AuditLog.created_at.desc()).limit(limit).all()


def get_override_actions(db: Session, date_from: Optional[datetime] = None, limit: int = 100) -> list[AuditLog]:
    """Gets all override actions (for audit compliance)."""
    override_actions = [
        AuditAction.OVERRIDE_MANUAL_REASSIGN,
        AuditAction.OVERRIDE_FORCE_CANCEL,
        AuditAction.OVERRIDE_MANUAL_FAIL,
        AuditAction.OVERRIDE_MANUAL_PAUSE,
        AuditAction.OVERRIDE_MANUAL_RESUME,
        AuditAction.OVERRIDE_SEND_TO_CHARGE,
    ]
    
    query = db.query(AuditLog).filter(AuditLog.action.in_(override_actions))
    
    if date_from:
        query = query.filter(AuditLog.created_at >= date_from)
    
    return query.order_by(AuditLog.created_at.desc()).limit(limit).all()


def get_recent_activity(db: Session, limit: int = 50) -> list[AuditLog]:
    """Gets recent system activity."""
    return db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()


def get_activity_summary(db: Session, date_from: datetime, date_to: datetime) -> dict:
    """
    Gets activity summary for a time range.
    """
    from sqlalchemy import func
    
    query = db.query(AuditLog).filter(
        AuditLog.created_at >= date_from,
        AuditLog.created_at <= date_to
    )
    
    total_actions = query.count()
    

    system_actions = db.query(AuditLog).filter(
        AuditLog.created_at >= date_from,
        AuditLog.created_at <= date_to,
        AuditLog.user_id.is_(None)
    ).count()
    
    user_actions = db.query(AuditLog).filter(
        AuditLog.created_at >= date_from,
        AuditLog.created_at <= date_to,
        AuditLog.user_id.isnot(None),
        ~AuditLog.action.ilike("%OVERRIDE%"),
        ~AuditLog.action.ilike("%LOGIN%"),
        ~AuditLog.action.ilike("%DELETE%")
    ).count()
    
    security_actions = db.query(AuditLog).filter(
        AuditLog.created_at >= date_from,
        AuditLog.created_at <= date_to,
        (AuditLog.action.ilike("%OVERRIDE%") | AuditLog.action.ilike("%LOGIN%") | AuditLog.action.ilike("%DELETE%"))
    ).count()
    

    action_counts = db.query(
        AuditLog.action, func.count(AuditLog.id)
    ).filter(
        AuditLog.created_at >= date_from,
        AuditLog.created_at <= date_to
    ).group_by(AuditLog.action).all()
    

    entity_counts = db.query(
        AuditLog.entity_type, func.count(AuditLog.id)
    ).filter(
        AuditLog.created_at >= date_from,
        AuditLog.created_at <= date_to
    ).group_by(AuditLog.entity_type).all()
    

    user_counts = db.query(
        AuditLog.user_email, func.count(AuditLog.id)
    ).filter(
        AuditLog.created_at >= date_from,
        AuditLog.created_at <= date_to,
        AuditLog.user_email != None
    ).group_by(AuditLog.user_email).order_by(func.count(AuditLog.id).desc()).limit(10).all()
    
    return {
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "total_actions": total_actions,
        "system_actions": system_actions,
        "user_actions": user_actions,
        "security_actions": security_actions,
        "actions_by_type": {action: count for action, count in action_counts},
        "actions_by_entity": {entity: count for entity, count in entity_counts},
        "top_users": [{"email": email, "count": count} for email, count in user_counts]
    }
