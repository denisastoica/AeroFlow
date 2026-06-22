from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Index
from sqlalchemy.orm import relationship
from backend.database import Base


class MissionEvent(Base):
    __tablename__ = "mission_events"
    __table_args__ = (
        Index("idx_mission_events_mission_ts", "mission_id", "timestamp"),
    )

    id = Column(Integer, primary_key=True, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id"), nullable=False)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    event_type = Column(String, nullable=False)
    details = Column(Text, nullable=True)

    mission = relationship("Mission", back_populates="events", lazy="select")
