from sqlalchemy import Column, Integer, String, Float, JSON, CheckConstraint
from sqlalchemy.orm import relationship
from backend.database import Base


class Drone(Base):
    __tablename__ = "drones"
    __table_args__ = (
        CheckConstraint(
            "status IN ('idle', 'in_mission', 'charging', 'going_to_charging', 'maintenance', 'inactive')",
            name="ck_drones_status"
        ),
        CheckConstraint("battery >= 0 AND battery <= 100", name="ck_drones_battery_range"),
        CheckConstraint("battery_health >= 0 AND battery_health <= 100", name="ck_drones_health_range"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    status = Column(String, default="idle")
    battery = Column(Float, default=100.0)
    latitude = Column(Float, default=0.0)
    longitude = Column(Float, default=0.0)

    route_path = Column(JSON, nullable=True)
    route_index = Column(Integer, default=0)

    dest_latitude = Column(Float, nullable=True)
    dest_longitude = Column(Float, nullable=True)

    planned_route_path = Column(JSON, nullable=True)

    stuck_steps = Column(Integer, default=0)
    charge_count = Column(Integer, default=0)
    maintenance_source = Column(String, nullable=True)


    max_battery_wh = Column(Float, default=500.0)
    battery_health = Column(Float, default=100.0)
    total_flight_km = Column(Float, default=0.0)
    total_charge_cycles = Column(Integer, default=0)
    motor_efficiency = Column(Float, default=0.92)
    weight_kg = Column(Float, default=3.5)

    deliveries = relationship("Delivery", back_populates="drone", lazy="select")
    missions = relationship("Mission", back_populates="drone", lazy="select")
