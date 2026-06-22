from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, CheckConstraint
from datetime import datetime, timezone
from backend.database import Base


class NoFlyZone(Base):
    __tablename__ = "no_fly_zones"
    __table_args__ = (
        CheckConstraint("radius_km > 0", name="ck_nfz_radius_positive"),
        CheckConstraint(
            "zone_type IN ('permanent', 'temporary', 'emergency')",
            name="ck_nfz_zone_type"
        ),
        CheckConstraint(
            "center_lat >= -90 AND center_lat <= 90",
            name="ck_nfz_lat_range"
        ),
        CheckConstraint(
            "center_lon >= -180 AND center_lon <= 180",
            name="ck_nfz_lon_range"
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    center_lat = Column(Float, nullable=False)
    center_lon = Column(Float, nullable=False)
    radius_km = Column(Float, nullable=False, default=5.0)
    reason = Column(String, nullable=True)
    zone_type = Column(String, default="permanent")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    expires_at = Column(DateTime, nullable=True)
