"""
Bootstrap Service — Centralizes application startup logic.
Manages seeds, cleaning of stuck entities, and initialization of background services.
"""
import os
import bcrypt
from datetime import datetime
from sqlalchemy.orm import Session, sessionmaker
from backend.database import engine
from backend.models.user import User
from backend.models.drone import Drone
from backend.models.delivery import Delivery
from backend.models.mission import Mission
from backend.app.core.delivery_state import DeliveryStatus, MissionStatus, ACTIVE_MISSION_STATUSES
from backend.services.fleet_reset_service import ensure_minimum_drones, DEFAULT_MIN_FLEET
from backend.services.no_fly_zone_service import seed_default_zones, refresh_cache as refresh_nfz_cache
from backend.services.drone_simulator import start_simulator
from backend.services.weather_service import start_weather_service
from backend.services.warning_service import start_warning_service

def run_bootstrap(db: Session):
    """
    Executes all initialization steps required on server startup.
    Order is important: Users -> Drones -> NFZ -> Cleanup -> Background Services.
    """
    print("[Bootstrap] Starting initialization process...")
    

    _seed_users(db)
    

    _seed_drones(db)
    

    from backend.services.charging_stations import seed_and_load_stations
    seed_and_load_stations(db)
    

    seed_default_zones(db)
    refresh_nfz_cache(db)
    

    _fix_stuck_entities(db)
    

    start_simulator()
    start_weather_service()
    start_warning_service()
    
    print("[Bootstrap] Initialization completed successfully.")

def _seed_users(db: Session):
    """Creates demo users if the database is empty."""
    def hash_password(password: str) -> str:
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

    demo_users = [
        {"email": "admin@example.com", "name": "Admin Demo", "phone": "+40700000000", "role": "admin"},
        {"email": "customer@example.com", "name": "Customer Demo", "phone": "+40701234567", "role": "customer"},
        {"email": "dispatcher@example.com", "name": "Dispatcher Demo", "phone": "+40702345678", "role": "dispatcher"},
    ]

    created = 0
    for u in demo_users:
        existing = db.query(User).filter(User.email == u["email"]).first()
        if not existing:
            db.add(User(
                email=u["email"],
                hashed_password=hash_password("Pass123!"),
                name=u["name"],
                phone=u["phone"],
                role=u["role"],
                is_active=True,
            ))
            created += 1

    if created:
        db.commit()
        print(f"[Seed] {created} new users added.")

def _seed_drones(db: Session):
    """Ensures a minimum drone fleet for demo."""
    r = ensure_minimum_drones(db, DEFAULT_MIN_FLEET)
    if r.get("added", 0):
        print(f"[Seed] {r['added']} drones added. Total: {r['total']}.")

def _fix_stuck_entities(db: Session):
    """Fixes inconsistencies in the database state caused by unexpected shutdown."""
    fixed = 0
    

    active_deliveries = db.query(Delivery).filter(
        Delivery.status.in_([
            DeliveryStatus.ASSIGNED.value,
            DeliveryStatus.PICKING_UP.value,
            DeliveryStatus.PICKED_UP.value,
            DeliveryStatus.IN_TRANSIT.value,
            DeliveryStatus.IN_PROGRESS.value,
        ])
    ).all()
    
    for d in active_deliveries:
        should_fail = False
        if not d.drone_id:
            should_fail = True
        else:
            drone = db.query(Drone).filter(Drone.id == d.drone_id).first()
            if not drone or (drone.status == "idle" and not drone.route_path):
                should_fail = True
        
        if should_fail:
            d.status = DeliveryStatus.FAILED.value
            fixed += 1


    stuck_drones = db.query(Drone).filter(
        Drone.status.in_(["going_to_charging", "in_mission"])
    ).all()
    
    for drone in stuck_drones:
        if not drone.route_path or len(drone.route_path) < 2:
            from backend.services.charging_stations import get_nearest_station
            station = get_nearest_station(drone.latitude, drone.longitude)
            if station:
                drone.latitude, drone.longitude = station[0], station[1]
            drone.status = "idle"
            drone.route_path = None
            drone.route_index = 0
            drone.battery = 100.0
            drone.dest_latitude = None
            drone.dest_longitude = None
            fixed += 1


    maintenance_drones = db.query(Drone).filter(
        Drone.status == "maintenance"
    ).all()
    for drone in maintenance_drones:
        if getattr(drone, "maintenance_source", None) == "manual":
            continue
        drone.status = "idle"
        drone.maintenance_source = None
        drone.route_path = None
        drone.route_index = 0
        drone.stuck_steps = 0
        drone.charge_count = 0
        drone.dest_latitude = None
        drone.dest_longitude = None

        drone.battery = 100.0
        fixed += 1


    inconsistent_missions = db.query(Mission).filter(
        Mission.end_time != None,
        Mission.status.in_(list(ACTIVE_MISSION_STATUSES))
    ).all()
    for m in inconsistent_missions:
        m.status = MissionStatus.COMPLETED.value
        fixed += 1

    if fixed:
        db.commit()
        print(f"[Startup] Fixed {fixed} stuck items (deliveries/drones/missions).")
