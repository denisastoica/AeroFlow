from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from backend.database import SessionLocal
from backend.models.drone import Drone
from backend.models.user import User
from backend.schemas.drone import (
    DroneCreateRequest,
    DroneCreateByAddress,
    DroneDetailResponse,
    DroneResponse,
    DroneUpdateRequest,
    FleetStatusResponse,
    StartMissionRequest,
)
from backend.services.charging_stations import (
    MAX_AUTONOMY_KM,
    distance_to_nearest_station_km,
)
from backend.services.grid import city_grid
from backend.services.routing_utils import plan_route_leg
from backend.services.no_fly_zone_service import get_blocked_cells
from backend.services import mission_service
from backend.services.geocoding import geocode_address
from backend.services.drone_service import build_drone_detail
from backend.services.auth_dependencies import (
    get_current_user,
    require_role,
)
from backend.services.audit_service import log_drone_action
from backend.models.audit_log import AuditAction

router = APIRouter(prefix="/drones", tags=["Drones"])

RETURN_SERVICE_MIN_HEALTH = 95.0
RETURN_SERVICE_MIN_BATTERY = 30.0


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/", response_model=List[DroneDetailResponse])
def get_drones(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns the list of drones. Includes info about any current active mission.
    Accessible: authenticated users
    """
    drones = db.query(Drone).all()
    return [build_drone_detail(d, db) for d in drones]


@router.get("/fleet-status", response_model=FleetStatusResponse)
def fleet_status(
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns full fleet status with per-drone metrics.
    Includes: battery, health, autonomy, active missions, deliveries, stations.
    Accessible: dispatcher, admin
    """
    from backend.services.fleet_optimizer import get_fleet_status
    return get_fleet_status(db)


@router.post("/", response_model=DroneResponse, status_code=201)
def create_drone(
    request: DroneCreateRequest,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    db: Session = Depends(get_db)
):
    """
    Creates a new drone.
    Accessible: dispatcher, admin
    """
    drone = Drone(
        name=request.name,
        status=request.status or "idle",
        battery_health=request.battery_health if request.battery_health is not None else 100.0,
        maintenance_source="manual" if request.status == "maintenance" else None,
    )
    db.add(drone)
    db.commit()
    db.refresh(drone)
    return drone


@router.post("/add_by_address", response_model=DroneResponse, status_code=201)
def add_drone_by_address(
    drone: DroneCreateByAddress,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    db: Session = Depends(get_db)
):
    """
    Adds a new drone based on an address.
    Accessible: dispatcher, admin
    """
    lat, lon = geocode_address(drone.address)
    if not lat or not lon:
        raise HTTPException(status_code=404, detail="Address not found")

    new_drone = Drone(
        name=drone.name,
        latitude=lat,
        longitude=lon,
        status="idle",
        battery=100
    )
    db.add(new_drone)
    db.commit()
    db.refresh(new_drone)
    return new_drone


@router.patch("/{drone_id}", response_model=DroneResponse)
def update_drone(
    drone_id: int,
    request: DroneUpdateRequest,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    db: Session = Depends(get_db)
):
    """
    Updates drone properties.
    Accessible: dispatcher, admin
    """
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if not drone:
        raise HTTPException(status_code=404, detail="Drone not found")

    update_data = request.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(drone, key, value)

    if request.status is not None:
        if request.status == "maintenance":

            drone.maintenance_source = "manual"
            drone.stuck_steps = 0
        else:
            drone.maintenance_source = None
            drone.stuck_steps = 0

    db.commit()
    db.refresh(drone)
    return drone


@router.post("/{drone_id}/return-to-service", response_model=DroneResponse)
def return_drone_to_service(
    drone_id: int,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    db: Session = Depends(get_db)
):
    """
    Marks a manual maintenance drone as repaired and returns it to service.
    """
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if not drone:
        raise HTTPException(status_code=404, detail="Drone not found")

    if drone.status != "maintenance":
        raise HTTPException(status_code=400, detail="Drone is not in maintenance")

    drone.status = "idle"
    drone.maintenance_source = None
    drone.stuck_steps = 0
    drone.route_path = None
    drone.planned_route_path = None
    drone.route_index = 0
    drone.dest_latitude = None
    drone.dest_longitude = None


    drone.battery_health = max(float(drone.battery_health or 0), RETURN_SERVICE_MIN_HEALTH)
    drone.battery = max(float(drone.battery or 0), RETURN_SERVICE_MIN_BATTERY)

    db.commit()
    db.refresh(drone)
    return drone


@router.delete("/{drone_id}", status_code=204)
def delete_drone(
    drone_id: int,
    payload: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db)
):
    """
    Retires a drone from active operations (soft delete).
    Historical missions and deliveries remain available.
    Accessible: admin only
    """
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if not drone:
        raise HTTPException(status_code=404, detail="Drone not found")
    
    if drone.status in ("in_mission", "going_to_charging"):
        raise HTTPException(status_code=400, detail="Cannot retire a drone while it is active in a mission")


    drone.status = "inactive"
    drone.maintenance_source = None
    drone.route_path = None
    drone.planned_route_path = None
    drone.route_index = 0
    drone.dest_latitude = None
    drone.dest_longitude = None
    db.commit()
    return None


@router.get("/{drone_id}", response_model=DroneDetailResponse)
def get_drone(
    drone_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Gets details about a specific drone.
    Accessible: authenticated users
    """
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if not drone:
        raise HTTPException(status_code=404, detail="Drone not found")
    return build_drone_detail(drone, db)


@router.post("/{drone_id}/start_mission", response_model=DroneResponse)
def start_mission(
    drone_id: int,
    request: StartMissionRequest,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Starts a mission: safe route from current position to the destination.
    Uses A* on grid avoiding NFZ.
    Accessible: dispatcher, admin
    """
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if not drone:
        raise HTTPException(status_code=404, detail="Drone not found")

    if drone.status in ("in_mission", "going_to_charging"):
        raise HTTPException(status_code=400, detail="Drone is already in mission")
    if drone.status == "charging":
        raise HTTPException(status_code=400, detail="Drone is charging at station")
    if drone.battery < 10:
        raise HTTPException(status_code=400, detail="Insufficient battery (min 10%)")

    raw = request.path
    if not raw or len(raw) < 2:
        raise HTTPException(status_code=400, detail="Path must have at least 2 points (origin and destination)")

    dest_lat = float(raw[-1][0])
    dest_lon = float(raw[-1][1])
    cur_lat = float(drone.latitude)
    cur_lon = float(drone.longitude)


    blocked = get_blocked_cells(city_grid)
    path_tuples = plan_route_leg(
        cur_lat, cur_lon, dest_lat, dest_lon, blocked
    )
    if len(path_tuples) < 2:
        raise HTTPException(
            status_code=400,
            detail="Cannot calculate a safe route to destination (restricted zones or grid gap).",
        )

    path = [[float(p[0]), float(p[1])] for p in path_tuples]


    sample_step = max(1, len(path) // 15)
    for i in range(0, len(path), sample_step):
        lat, lon = float(path[i][0]), float(path[i][1])
        dist_km = distance_to_nearest_station_km(lat, lon)
        if dist_km is not None and dist_km > MAX_AUTONOMY_KM:
            raise HTTPException(
                status_code=400,
                detail=f"Route passes too far from any station (≥{MAX_AUTONOMY_KM} km). Choose a destination closer to the station network.",
            )

    drone.status = "in_mission"
    drone.route_path = path
    drone.route_index = 0
    drone.dest_latitude = dest_lat
    drone.dest_longitude = dest_lon

    db.commit()
    db.refresh(drone)
    return drone


@router.post("/{drone_id}/send-to-charge")
def send_drone_to_charge(
    drone_id: int,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Manually sends a drone to the nearest charging station.
    Creates a route to station and sets status to 'going_to_charging'.
    Accessible: dispatcher, admin
    """
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if not drone:
        raise HTTPException(status_code=404, detail="Drone not found")
    
    if drone.latitude is None or drone.longitude is None:
        raise HTTPException(status_code=400, detail="Drone has no position data")
    
    if drone.status == "charging":
        raise HTTPException(status_code=400, detail="Drone is already charging")
    

    from backend.services.charging_stations import get_nearest_station
    station = get_nearest_station(drone.latitude, drone.longitude)
    if not station:
        raise HTTPException(status_code=404, detail="No charging station available")
    
    station_lat, station_lon, station_name = station
    

    blocked = get_blocked_cells(city_grid)
    route_to_station = plan_route_leg(
        drone.latitude, drone.longitude,
        station_lat, station_lon,
        blocked,
    )
    
    if len(route_to_station) < 2:
        raise HTTPException(
            status_code=400,
            detail="Cannot find route to charging station (blocked by no-fly zones)"
        )
    

    from backend.services.grid import haversine_distance
    route_distance_km = 0.0
    for i in range(len(route_to_station)-1):
        route_distance_km += haversine_distance(
            route_to_station[i][0], route_to_station[i][1],
            route_to_station[i+1][0], route_to_station[i+1][1]
        )
        
    from backend.services.battery_service import estimate_range_km
    current_range = estimate_range_km(
        battery_pct=drone.battery,
        battery_health=drone.battery_health,
        weight_kg=3.5
    )
    
    if route_distance_km > current_range:
        raise HTTPException(
            status_code=400,
            detail=f"Drona nu are suficientă baterie pentru a ajunge la {station_name}. "
                   f"Necesar: {route_distance_km:.1f} km. Autonomie: {current_range:.1f} km."
        )
    

    drone.route_path = [[float(p[0]), float(p[1])] for p in route_to_station]
    drone.route_index = 0
    drone.dest_latitude = station_lat
    drone.dest_longitude = station_lon
    drone.status = "going_to_charging"
    
    db.commit()
    db.refresh(drone)
    

    log_drone_action(
        db=db,
        action=AuditAction.OVERRIDE_SEND_TO_CHARGE,
        drone=drone,
        user=current_user,
        description=f"Drone manually sent to charging station: {station_name}"
    )
    
    return {
        "message": f"Drone sent to charging station: {station_name}",
        "drone_id": drone.id,
        "station": {"name": station_name, "lat": station_lat, "lon": station_lon},
        "status": drone.status,
    }
