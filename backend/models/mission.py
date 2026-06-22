from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Float, ForeignKey, DateTime, String, CheckConstraint, Index, JSON
from sqlalchemy.orm import relationship
from backend.database import Base


class Mission(Base):
    __tablename__ = "missions"
    __table_args__ = (
        CheckConstraint("progress_pct >= 0 AND progress_pct <= 100", name="ck_missions_progress"),
        CheckConstraint(
            "status IN ('planned', 'pending', 'en_route_pickup', 'at_pickup', "
            "'en_route_delivery', 'in_progress', 'charging', 'paused', 'completed', 'aborted', 'failed')",
            name="ck_missions_status"
        ),
        Index("idx_missions_drone_status", "drone_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    drone_id = Column(Integer, ForeignKey("drones.id"), nullable=False)
    delivery_id = Column(Integer, ForeignKey("deliveries.id"), nullable=False)

    start_time = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    end_time = Column(DateTime, nullable=True)


    estimated_distance_km = Column(Float, nullable=True)
    estimated_duration_h = Column(Float, nullable=True)
    total_distance_km = Column(Float, nullable=True)
    start_flight_km = Column(Float, default=0.0)


    progress_pct = Column(Float, default=0.0)
    remaining_km = Column(Float, nullable=True)
    remaining_duration_h = Column(Float, nullable=True)

    actual_duration_h = Column(Float, nullable=True)
    status = Column(String, default="planned")


    pickup_waypoint_index = Column(Integer, nullable=True)


    planned_route_path = Column(JSON, nullable=True)


    remaining_km_to_pickup = Column(Float, nullable=True)
    remaining_km_to_destination = Column(Float, nullable=True)

    drone = relationship("Drone", back_populates="missions", lazy="select")
    delivery = relationship("Delivery", back_populates="missions", lazy="select")
    events = relationship("MissionEvent", back_populates="mission", order_by="MissionEvent.timestamp", lazy="select")
