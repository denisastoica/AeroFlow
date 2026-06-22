"""
Model for Audit Log — records all important system actions.
Provides complete traceability for admins and compliance.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Index
from sqlalchemy.orm import relationship
from backend.database import Base


class AuditLog(Base):
    """
    Audit log for all system actions.
    
    Event categories:
    - DELIVERY_* : delivery operations
    - MISSION_* : mission operations
    - DRONE_* : drone operations
    - USER_* : user operations
    - SYSTEM_* : system events
    """
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("idx_audit_entity", "entity_type", "entity_id"),
        Index("idx_audit_user", "user_id"),
        Index("idx_audit_action", "action"),
        Index("idx_audit_created", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    

    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    user_email = Column(String(255), nullable=True)
    user_role = Column(String(50), nullable=True)
    

    entity_type = Column(String(50), nullable=False)
    entity_id = Column(Integer, nullable=True)
    

    action = Column(String(100), nullable=False)
    

    description = Column(Text, nullable=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    extra_data = Column(Text, nullable=True)
    

    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)
    

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), index=True)
    

    user = relationship("User", backref="audit_logs", lazy="select")


class AuditAction:
    """Constants for audit action types."""
    

    DELIVERY_CREATED = "DELIVERY_CREATED"
    DELIVERY_ASSIGNED = "DELIVERY_ASSIGNED"
    DELIVERY_REASSIGNED = "DELIVERY_REASSIGNED"
    DELIVERY_CANCELLED = "DELIVERY_CANCELLED"
    DELIVERY_FORCE_CANCELLED = "DELIVERY_FORCE_CANCELLED"
    DELIVERY_STATUS_CHANGED = "DELIVERY_STATUS_CHANGED"
    DELIVERY_CONFIRMED = "DELIVERY_CONFIRMED"
    DELIVERY_PHOTO_UPLOADED = "DELIVERY_PHOTO_UPLOADED"
    

    MISSION_CREATED = "MISSION_CREATED"
    MISSION_STARTED = "MISSION_STARTED"
    MISSION_COMPLETED = "MISSION_COMPLETED"
    MISSION_FAILED = "MISSION_FAILED"
    MISSION_ABORTED = "MISSION_ABORTED"
    MISSION_PAUSED = "MISSION_PAUSED"
    MISSION_RESUMED = "MISSION_RESUMED"
    MISSION_STATUS_CHANGED = "MISSION_STATUS_CHANGED"
    

    DRONE_CREATED = "DRONE_CREATED"
    DRONE_STATUS_CHANGED = "DRONE_STATUS_CHANGED"
    DRONE_SENT_TO_CHARGE = "DRONE_SENT_TO_CHARGE"
    DRONE_STARTED_CHARGING = "DRONE_STARTED_CHARGING"
    DRONE_FINISHED_CHARGING = "DRONE_FINISHED_CHARGING"
    DRONE_LOW_BATTERY_ALERT = "DRONE_LOW_BATTERY_ALERT"
    DRONE_HEALTH_DEGRADED = "DRONE_HEALTH_DEGRADED"
    

    USER_CREATED = "USER_CREATED"
    USER_LOGIN = "USER_LOGIN"
    USER_LOGIN_FAILED = "USER_LOGIN_FAILED"
    USER_LOGOUT = "USER_LOGOUT"
    USER_UNAUTHORIZED_ACCESS = "USER_UNAUTHORIZED_ACCESS"
    USER_ROLE_CHANGED = "USER_ROLE_CHANGED"
    USER_PROFILE_UPDATED = "USER_PROFILE_UPDATED"
    

    SYSTEM_STARTUP = "SYSTEM_STARTUP"
    SYSTEM_MIGRATION_RUN = "SYSTEM_MIGRATION_RUN"
    SYSTEM_CONFIG_CHANGED = "SYSTEM_CONFIG_CHANGED"
    SYSTEM_BATCH_ASSIGN = "SYSTEM_BATCH_ASSIGN"
    SYSTEM_FLEET_RESET = "SYSTEM_FLEET_RESET"
    

    OVERRIDE_MANUAL_REASSIGN = "OVERRIDE_MANUAL_REASSIGN"
    OVERRIDE_FORCE_CANCEL = "OVERRIDE_FORCE_CANCEL"
    OVERRIDE_MANUAL_FAIL = "OVERRIDE_MANUAL_FAIL"
    OVERRIDE_MANUAL_PAUSE = "OVERRIDE_MANUAL_PAUSE"
    OVERRIDE_MANUAL_RESUME = "OVERRIDE_MANUAL_RESUME"
    OVERRIDE_SEND_TO_CHARGE = "OVERRIDE_SEND_TO_CHARGE"


class AuditEntityType:
    """Entity types for audit."""
    DELIVERY = "delivery"
    MISSION = "mission"
    DRONE = "drone"
    USER = "user"
    SYSTEM = "system"
    ALERT = "alert"
    NO_FLY_ZONE = "no_fly_zone"
