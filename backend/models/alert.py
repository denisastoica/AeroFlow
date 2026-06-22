from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Boolean, Index
from backend.database import Base


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        Index("idx_alerts_severity_status", "severity", "status"),
        Index("idx_alerts_drone_id", "drone_id"),
        Index("idx_alerts_delivery_id", "delivery_id"),
    )

    id = Column(Integer, primary_key=True, index=True)


    alert_type = Column(String, nullable=False)

    severity = Column(String, nullable=False, default="warning")


    drone_id = Column(Integer, ForeignKey("drones.id", ondelete="SET NULL"), nullable=True)
    delivery_id = Column(Integer, ForeignKey("deliveries.id", ondelete="SET NULL"), nullable=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="SET NULL"), nullable=True)

    message = Column(Text, nullable=False)
    details = Column(Text, nullable=True)


    status = Column(String, nullable=False, default="new")
    occurrence_count = Column(Integer, default=1, nullable=False)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    acknowledged_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    

    @property
    def acknowledged(self):
        return self.status != "new"
