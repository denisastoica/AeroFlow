from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, CheckConstraint, Index
from sqlalchemy.orm import relationship
from backend.database import Base
from backend.app.core.delivery_state import DeliveryStatus


class Delivery(Base):
    __tablename__ = "deliveries"
    __table_args__ = (
        CheckConstraint(
            "priority IN ('normal', 'urgent', 'emergency')",
            name="ck_deliveries_priority"
        ),
        CheckConstraint(
            "package_type IN ('standard', 'medical', 'fragile', 'food')",
            name="ck_deliveries_package_type"
        ),
        CheckConstraint("weight_kg > 0 AND weight_kg <= 3", name="ck_deliveries_weight"),
        CheckConstraint(
            "pickup_lat >= -90 AND pickup_lat <= 90 AND dest_lat >= -90 AND dest_lat <= 90",
            name="ck_deliveries_lat_range"
        ),
        CheckConstraint(
            "pickup_lon >= -180 AND pickup_lon <= 180 AND dest_lon >= -180 AND dest_lon <= 180",
            name="ck_deliveries_lon_range"
        ),
        Index("idx_deliveries_status_priority", "status", "priority"),
    )

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    pickup_lat = Column(Float, nullable=False)
    pickup_lon = Column(Float, nullable=False)
    dest_lat = Column(Float, nullable=False)
    dest_lon = Column(Float, nullable=False)
    pickup_address = Column(String(500), nullable=True)
    dest_address = Column(String(500), nullable=True)
    status = Column(String, default=DeliveryStatus.PENDING.value)
    failure_reason = Column(String, nullable=True)
    drone_id = Column(Integer, ForeignKey("drones.id", ondelete="SET NULL"), nullable=True)


    priority = Column(String, default="normal")
    package_type = Column(String, default="standard")
    notes = Column(String, nullable=True)
    weight_kg = Column(Float, default=1.0)


    estimated_distance_km = Column(Float, nullable=True)
    estimated_duration_h = Column(Float, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime, nullable=True)


    confirmation_code = Column(String(6), nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    recipient_name = Column(String(100), nullable=True)
    recipient_signature = Column(String, nullable=True)
    delivery_photo_url = Column(String(500), nullable=True)
    delivery_notes = Column(String(500), nullable=True)


    dropoff_safety_status = Column(String, nullable=True)
    dropoff_safety_reason = Column(String, nullable=True)
    dropoff_weather_safe = Column(String, nullable=True)
    dropoff_battery_pct = Column(Float, nullable=True)
    dropoff_distance_m = Column(Float, nullable=True)
    dropoff_code_required = Column(String, nullable=True)

    customer = relationship("User", back_populates="deliveries", lazy="select")
    drone = relationship("Drone", back_populates="deliveries", lazy="select")
    missions = relationship("Mission", back_populates="delivery", lazy="select")

    @property
    def customer_name(self):
        return self.customer.name if self.customer else None

    @property
    def drone_name(self):
        return self.drone.name if self.drone else None
