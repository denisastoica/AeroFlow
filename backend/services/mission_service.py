"""Operations for mission records (tracking drone deliveries)."""
from typing import Optional, List
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from backend.models.mission import Mission
from backend.app.core.delivery_state import MissionStatus, ACTIVE_MISSION_STATUSES
from backend.services.grid import haversine_distance


def _duration_h(start_time, end_time) -> float:
    """Compute duration in hours, tolerating a mix of naive and aware datetimes."""
    if not start_time or not end_time:
        return 0.0

    if start_time.tzinfo is None:
        start_time = start_time.replace(tzinfo=timezone.utc)
    if end_time.tzinfo is None:
        end_time = end_time.replace(tzinfo=timezone.utc)
    return (end_time - start_time).total_seconds() / 3600.0

def create_mission(db: Session, drone_id: int, delivery_id: int,
                   estimated_distance_km: Optional[float] = None,
                   estimated_duration_h: Optional[float] = None,
                   total_distance_km: Optional[float] = None,
                   pickup_waypoint_index: Optional[int] = None,
                   planned_route_path: Optional[List[List[float]]] = None) -> Mission:

    from backend.models.drone import Drone
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    start_flight_km = float(drone.total_flight_km or 0.0) if drone else 0.0

    mission = Mission(
        drone_id=drone_id,
        delivery_id=delivery_id,
        estimated_distance_km=estimated_distance_km,
        estimated_duration_h=estimated_duration_h,
        total_distance_km=total_distance_km,
        start_flight_km=start_flight_km,
        remaining_km=total_distance_km,
        remaining_duration_h=(
            (estimated_duration_h / total_distance_km) * total_distance_km
            if estimated_duration_h and total_distance_km
            else None
        ),
        start_time=datetime.now(timezone.utc),
        status=MissionStatus.PLANNED.value,
        progress_pct=0.0,
        pickup_waypoint_index=pickup_waypoint_index,
        planned_route_path=planned_route_path,
    )
    db.add(mission)
    db.commit()
    db.refresh(mission)
    return mission


def complete_mission(db: Session, delivery_id: int) -> Optional[Mission]:
    """Mark mission associated with a delivery as finished."""
    mission = db.query(Mission).filter(
        Mission.delivery_id == delivery_id,
        Mission.end_time.is_(None),
    ).first()
    if not mission:
        print(f"[MissionService] No active mission found to complete for delivery #{delivery_id}")
        return None
    
    mission.end_time = datetime.now(timezone.utc)
    if mission.start_time:
        mission.actual_duration_h = _duration_h(mission.start_time, mission.end_time)
    
    mission.progress_pct = 100.0
    mission.remaining_km = 0.0
    mission.remaining_duration_h = 0.0
    mission.status = MissionStatus.COMPLETED.value
    db.commit()
    print(f"[MissionService] Mission #{mission.id} COMPLETED for delivery #{delivery_id}")
    return mission


def fail_mission(db: Session, delivery_id: int, reason: str = None) -> Optional[Mission]:
    """Mark mission as failed."""
    mission = db.query(Mission).filter(
        Mission.delivery_id == delivery_id,
        Mission.end_time.is_(None),
    ).first()
    if not mission:
        print(f"[MissionService] No active mission found to fail for delivery #{delivery_id}")
        return None
    
    mission.end_time = datetime.now(timezone.utc)
    if mission.start_time:
        mission.actual_duration_h = _duration_h(mission.start_time, mission.end_time)
    
    mission.status = MissionStatus.FAILED.value
    db.commit()
    print(f"[MissionService] Mission #{mission.id} FAILED for delivery #{delivery_id} (Reason: {reason})")
    return mission


def abort_mission(db: Session, delivery_id: int, reason: str = None) -> Optional[Mission]:
    """Abort mission by dispatcher."""
    mission = db.query(Mission).filter(
        Mission.delivery_id == delivery_id,
        Mission.end_time == None,
    ).first()
    if not mission:
        return None
    mission.end_time = datetime.now(timezone.utc)
    if mission.start_time and mission.end_time:
        mission.actual_duration_h = _duration_h(mission.start_time, mission.end_time)
    mission.status = MissionStatus.ABORTED.value
    db.commit()
    return mission


def set_mission_status(db: Session, drone_id: int, new_status: MissionStatus) -> Optional[Mission]:
    """Set mission status for active mission of drone."""
    mission = get_active_mission_for_drone(db, drone_id)
    if mission:
        mission.status = new_status.value
        db.commit()
    return mission


def get_all_missions(db: Session) -> List[Mission]:
    return db.query(Mission).all()


def get_active_mission_for_drone(db: Session, drone_id: int) -> Optional[Mission]:
    return db.query(Mission).filter(
        Mission.drone_id == drone_id,
        Mission.status.in_(list(ACTIVE_MISSION_STATUSES)),
        Mission.end_time == None,
    ).order_by(Mission.start_time.desc()).first()


def update_progress(db: Session, drone) -> Optional[Mission]:
    """Update mission progress based on drone's current route_index and route_path.
    
    Handles charging detour: when drone status is going_to_charging or charging,
    the route_path refers to the detour route, not the original mission route.
    In that case, we preserve the last known progress and don't recalculate.
    """
    mission = get_active_mission_for_drone(db, drone.id)
    if not mission or mission.total_distance_km is None:
        return mission

    if mission.total_distance_km <= 0:
        mission.progress_pct = 100.0
        mission.remaining_km = 0.0
        mission.remaining_duration_h = 0.0
        db.commit()
        return mission


    current_total_flight = float(drone.total_flight_km or 0.0)
    start_total_flight = float(mission.start_flight_km or 0.0)
    
    covered = max(0.0, current_total_flight - start_total_flight)
    total = float(mission.total_distance_km)
    
    progress_pct = min(100.0, (covered / total) * 100)
    

    if mission.progress_pct:
        progress_pct = max(float(mission.progress_pct), progress_pct)

    mission.progress_pct = progress_pct
    mission.remaining_km = max(0.0, total - covered)


    path = drone.route_path or []
    idx = drone.route_index or 0
    pickup_idx = mission.pickup_waypoint_index

    if pickup_idx is not None and len(path) > 1:
        if idx >= pickup_idx:

            mission.remaining_km_to_pickup = 0.0

            remaining_dest = 0.0
            if idx < len(path):

                if idx < len(path) - 1:
                    remaining_dest += haversine_distance(
                        float(drone.latitude), float(drone.longitude),
                        path[idx + 1][0], path[idx + 1][1],
                    )

                    for i in range(idx + 1, len(path) - 1):
                        remaining_dest += haversine_distance(
                            path[i][0], path[i][1],
                            path[i + 1][0], path[i + 1][1],
                        )
            mission.remaining_km_to_destination = remaining_dest
        else:


            remaining_pickup = 0.0
            if idx < len(path) - 1:
                remaining_pickup += haversine_distance(
                    float(drone.latitude), float(drone.longitude),
                    path[idx + 1][0], path[idx + 1][1],
                )
                for i in range(idx + 1, min(pickup_idx, len(path) - 1)):
                    remaining_pickup += haversine_distance(
                        path[i][0], path[i][1],
                        path[i + 1][0], path[i + 1][1],
                    )
            mission.remaining_km_to_pickup = remaining_pickup

            remaining_dest = remaining_pickup
            for i in range(max(pickup_idx, idx + 1), len(path) - 1):
                remaining_dest += haversine_distance(
                    path[i][0], path[i][1],
                    path[i + 1][0], path[i + 1][1],
                )
            mission.remaining_km_to_destination = remaining_dest

    if mission.estimated_duration_h and mission.total_distance_km:
        rate = mission.estimated_duration_h / mission.total_distance_km
        mission.remaining_duration_h = mission.remaining_km * rate
    db.commit()
    return mission


def mission_stats(db: Session):
    """Return simple aggregated statistics over missions."""
    missions = db.query(Mission).all()
    total = len(missions)

    completed = len([m for m in missions if m.status == MissionStatus.COMPLETED.value])
    failed = len([m for m in missions if m.status == MissionStatus.FAILED.value])
    aborted = len([m for m in missions if m.status == MissionStatus.ABORTED.value])
    planned = len([m for m in missions if m.status in (MissionStatus.PLANNED.value, MissionStatus.PENDING.value)])
    en_route_pickup = len([m for m in missions if m.status == MissionStatus.EN_ROUTE_PICKUP.value])
    at_pickup = len([m for m in missions if m.status == MissionStatus.AT_PICKUP.value])
    en_route_delivery = len([m for m in missions if m.status in (MissionStatus.EN_ROUTE_DELIVERY.value, MissionStatus.IN_PROGRESS.value)])
    charging = len([m for m in missions if m.status == MissionStatus.CHARGING.value])
    in_flight = en_route_pickup + at_pickup + en_route_delivery

    finished = [m for m in missions if m.status == MissionStatus.COMPLETED.value]
    avg_est_dur = None
    avg_act_dur = None
    if finished:
        avg_est_dur = sum((m.estimated_duration_h or 0) for m in finished) / len(finished)
        avg_act_dur = sum((m.actual_duration_h or 0) for m in finished) / len(finished)
    return {
        "total": total,
        "completed": completed,
        "failed": failed,
        "aborted": aborted,
        "planned": planned,
        "en_route_pickup": en_route_pickup,
        "at_pickup": at_pickup,
        "en_route_delivery": en_route_delivery,
        "in_flight": in_flight,
        "charging": charging,
        "avg_estimated_duration_h": avg_est_dur,
        "avg_actual_duration_h": avg_act_dur,
    }


def build_mission_eta(db: Session, mission: Mission, weight_kg: float = 3.5) -> dict:
    """
    Calculates detailed mission ETA based on remaining distance,
    simulated speed, and current weather conditions.
    """
    from backend.models.drone import Drone
    from backend.services.battery_service import compute_effective_speed

    drone = db.query(Drone).filter(Drone.id == mission.drone_id).first()

    remaining_km = float(mission.remaining_km or 0)
    remaining_km_to_pickup = float(mission.remaining_km_to_pickup or 0) if mission.remaining_km_to_pickup is not None else None
    remaining_km_to_destination = float(mission.remaining_km_to_destination or 0) if mission.remaining_km_to_destination is not None else None


    speed_km_h = compute_effective_speed(weight_kg=weight_kg, weather_speed_mult=1.0)


    weather_info = None
    if drone and drone.latitude is not None and drone.longitude is not None:
        try:
            from backend.services.weather_service import get_weather_impact_at
            weather_info = get_weather_impact_at(float(drone.latitude), float(drone.longitude))
            speed_km_h = compute_effective_speed(
                weight_kg=weight_kg,
                weather_speed_mult=weather_info.get("speed_multiplier", 1.0),
            )
        except Exception:
            pass


    from backend.services.drone_simulator import SIM_DRONE_SPEED_KM_PER_TICK, STEP_INTERVAL_SEC
    sim_speed = SIM_DRONE_SPEED_KM_PER_TICK * (weather_info.get("speed_multiplier", 1.0) if weather_info else 1.0)
    eta_sim_s = round(remaining_km / sim_speed) if sim_speed > 0 else None

    result = {
        "mission_id": mission.id,
        "status": mission.status,
        "progress_pct": round(float(mission.progress_pct or 0), 1),
        "remaining_km": round(remaining_km, 2),
        "remaining_duration_h": round(float(mission.remaining_duration_h or 0), 4),
        "eta_sim_seconds": eta_sim_s,
        "effective_speed_km_h": round(speed_km_h, 1),
    }

    if remaining_km_to_pickup is not None:
        result["remaining_km_to_pickup"] = round(remaining_km_to_pickup, 3)
        result["eta_sim_s_to_pickup"] = round(remaining_km_to_pickup / sim_speed) if sim_speed > 0 else None

    if remaining_km_to_destination is not None:
        result["remaining_km_to_destination"] = round(remaining_km_to_destination, 3)
        result["eta_sim_s_to_destination"] = round(remaining_km_to_destination / sim_speed) if sim_speed > 0 else None

    if weather_info:
        result["weather"] = {
            "speed_multiplier": round(weather_info.get("speed_multiplier", 1.0), 2),
            "battery_multiplier": round(weather_info.get("battery_multiplier", 1.0), 2),
            "can_fly": weather_info.get("can_fly", True),
            "warning": weather_info.get("warning"),
        }

    return result
