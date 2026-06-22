"""Service for logging mission events."""
from typing import Optional
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from backend.models.mission_event import MissionEvent


def log_event(db: Session, mission_id: int, event_type: str, details: Optional[str] = None) -> MissionEvent:
    """Log an event for a mission."""
    event = MissionEvent(
        mission_id=mission_id,
        event_type=event_type,
        details=details,
        timestamp=datetime.now(timezone.utc),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def get_events_for_mission(db: Session, mission_id: int):
    """Get all events for a mission, ordered by timestamp."""
    return db.query(MissionEvent).filter(MissionEvent.mission_id == mission_id).order_by(MissionEvent.timestamp).all()
