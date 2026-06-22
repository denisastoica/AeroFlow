"""
Multi-drone fleet optimization service.
Intelligently assigns deliveries considering: distance, battery, health,
priority, package weight, weather, restricted zones.
"""
from typing import List, Dict, Tuple, Optional
from sqlalchemy.orm import Session

from backend.models.drone import Drone
from backend.models.delivery import Delivery
from backend.models.mission import Mission
from backend.services.grid import city_grid, haversine_distance
from backend.services.battery_service import estimate_range_km
from backend.services.weather_service import get_weather_impact_at
from backend.services.no_fly_zone_service import get_blocked_cells
from backend.services.charging_stations import get_nearest_station
from backend.app.core.delivery_state import (
    ASSIGNABLE_DELIVERY_STATUSES,
    ACTIVE_DELIVERY_STATUSES,
    ACTIVE_MISSION_STATUSES,
)


W_DISTANCE = 0.30
W_BATTERY = 0.25
W_HEALTH = 0.15
W_RANGE_MARGIN = 0.20
W_WEATHER = 0.10


def find_best_drone(
    db: Session,
    delivery: Delivery,
    exclude_drone_ids: set = None,
) -> Optional[Dict]:
    """
    Finds the best drone for a delivery using the unified ranking logic.
    Returns a dict with drone details and score.
    """
    from backend.services.delivery_service import rank_drones_for_delivery
    ranked = rank_drones_for_delivery(db, delivery, exclude_drone_ids=exclude_drone_ids)
    
    if not ranked:
        return None
    
    best = ranked[0]
    drone = best["drone"]
    
    return {
        "drone_id": drone.id,
        "drone_name": drone.name,
        "score": best["score"],
        "dist_to_pickup_km": best["dist_to_pickup_km"],
        "total_dist_km": best["route_total_km"],
        "battery": drone.battery,
        "battery_health": getattr(drone, "battery_health", 100.0),
        "charging_stops": best["charging_stops"],
        "drone_obj": drone
    }


def optimize_batch_assignment(db: Session) -> Dict:
    """
    Batch optimization: assigns all pending deliveries to available drones.
    
    Greedy priority algorithm:
    1. Sorts deliveries: emergency > urgent > normal, then oldest first
    2. For each delivery, calculates the score with each available drone
    3. Greedily assigns (best pair first)
    4. Assigned drone is no longer available for subsequent deliveries
    """
    from backend.services.delivery_service import auto_assign_delivery, PRIORITY_ORDER

    pending = db.query(Delivery).filter(
        Delivery.status.in_(list(ASSIGNABLE_DELIVERY_STATUSES))
    ).all()

    if not pending:
        return {"assigned": 0, "failed": 0, "skipped": 0, "details": [], "message": "No pending deliveries"}


    pending.sort(key=lambda d: (
        -PRIORITY_ORDER.get(getattr(d, "priority", "normal") or "normal", 0),
        d.created_at or 0,
    ))


    blocked = get_blocked_cells(city_grid)

    assigned_count = 0
    failed_count = 0
    skipped_count = 0
    used_drone_ids = set()
    details = []

    for delivery in pending:

        current_idle_count = db.query(Drone).filter(Drone.status == "idle").filter(~Drone.id.in_(used_drone_ids)).count()
        if current_idle_count == 0:
            skipped_count += len(pending) - assigned_count - failed_count
            break


        best_result = find_best_drone(db, delivery, exclude_drone_ids=used_drone_ids)

        if not best_result:
            failed_count += 1
            details.append({
                "delivery_id": delivery.id,
                "priority": getattr(delivery, "priority", "normal"),
                "status": "no_drone",
                "reason": "No drone found by unified ranking (insufficient battery or no route)",
            })
            continue


        success = auto_assign_delivery(db, delivery, exclude_drone_ids=used_drone_ids)
        if success:
            assigned_count += 1
            actual_id = int(delivery.drone_id)
            used_drone_ids.add(actual_id)
            assigned_drone = db.query(Drone).filter(Drone.id == actual_id).first()
            details.append({
                "delivery_id": delivery.id,
                "priority": getattr(delivery, "priority", "normal"),
                "drone_id": actual_id,
                "drone_name": getattr(assigned_drone, "name", None) if assigned_drone else None,
                "status": "assigned",
            })

        else:
            failed_count += 1
            details.append({
                "delivery_id": delivery.id,
                "priority": getattr(delivery, "priority", "normal"),
                "status": "assign_failed",
                "reason": "auto_assign_delivery returned False",
            })

    return {
        "assigned": assigned_count,
        "failed": failed_count,
        "skipped": skipped_count,
        "total_pending": len(pending),
        "details": details,
        "message": f"{assigned_count} deliveries assigned, {failed_count} failed, {skipped_count} without drone",
    }


def get_fleet_status(db: Session) -> Dict:
    """
    Returns full fleet status with per-drone metrics.
    """
    drones = db.query(Drone).all()
    active_missions = db.query(Mission).filter(
        Mission.status.in_(list(ACTIVE_MISSION_STATUSES))
    ).all()
    

    mission_map = {}
    for m in active_missions:
        mission_map[m.drone_id] = m


    active_deliveries = db.query(Delivery).filter(
        Delivery.status.in_(list(ACTIVE_DELIVERY_STATUSES))
    ).all()
    delivery_map = {}
    for d in active_deliveries:
        if d.drone_id:
            delivery_map[d.drone_id] = d

    fleet = []
    status_counts = {"idle": 0, "in_mission": 0, "charging": 0}
    total_battery = 0
    total_health = 0

    for drone in drones:
        est_range = estimate_range_km(
            battery_pct=float(drone.battery or 0),
            max_battery_wh=float(drone.max_battery_wh or 500),
            battery_health=float(drone.battery_health or 100),
            weight_kg=float(drone.weight_kg or 3.5),
            motor_efficiency=float(drone.motor_efficiency or 0.92),
        )


        nearest_station = get_nearest_station(drone.latitude, drone.longitude)
        dist_to_station = None
        if nearest_station:
            dist_to_station = round(haversine_distance(
                drone.latitude, drone.longitude,
                nearest_station[0], nearest_station[1],
            ), 2)

        mission = mission_map.get(drone.id)
        delivery = delivery_map.get(drone.id)
        effective_status = _resolve_fleet_status(drone.status, mission=mission, delivery=delivery)

        drone_info = {
            "id": drone.id,
            "name": drone.name,
            "status": effective_status,
            "maintenance_source": getattr(drone, "maintenance_source", None),
            "latitude": float(drone.latitude) if drone.latitude else None,
            "longitude": float(drone.longitude) if drone.longitude else None,
            "battery": round(float(drone.battery or 0), 1),
            "battery_health": round(float(drone.battery_health or 100), 1),
            "estimated_range_km": round(est_range, 1),
            "total_flight_km": round(float(drone.total_flight_km or 0), 1),
            "total_charge_cycles": int(drone.total_charge_cycles or 0),
            "motor_efficiency": round(float(drone.motor_efficiency or 0.92), 2),
            "weight_kg": round(float(drone.weight_kg or 3.5), 1),
            "planned_route_path": drone.planned_route_path,
            "nearest_station_km": dist_to_station,
            "mission": None,
            "delivery": None,
        }


        if mission:
            drone_info["mission"] = {
                "id": mission.id,
                "progress_pct": round(float(mission.progress_pct or 0), 1),
                "remaining_km": round(float(mission.remaining_km or 0), 2),
                "remaining_duration_h": round(float(mission.remaining_duration_h or 0), 4),
                "status": mission.status,
            }


        if delivery:
            drone_info["delivery"] = {
                "id": delivery.id,
                "priority": getattr(delivery, "priority", "normal"),
                "package_type": getattr(delivery, "package_type", "standard"),
                "status": delivery.status,
            }

        fleet.append(drone_info)
        status_counts[effective_status] = status_counts.get(effective_status, 0) + 1
        total_battery += float(drone.battery or 0)
        total_health += float(drone.battery_health or 100)

    n = max(1, len(drones))
    

    pending_count = db.query(Delivery).filter(
        Delivery.status.in_(list(ASSIGNABLE_DELIVERY_STATUSES))
    ).count()

    return {
        "drones": fleet,
        "summary": {
            "total": len(drones),
            "by_status": status_counts,
            "avg_battery": round(total_battery / n, 1),
            "avg_health": round(total_health / n, 1),
            "pending_deliveries": pending_count,
        },
    }


def _resolve_fleet_status(raw_status: str, *, mission=None, delivery=None) -> str:
    """Normalize fleet status so cards and counters reflect active work."""
    if raw_status in {"maintenance", "inactive"}:
        return raw_status
    if raw_status in {"charging", "going_to_charging"} or getattr(mission, "status", None) == "charging":
        return "charging"
    if mission is not None or delivery is not None or raw_status == "in_mission":
        return "in_mission"
    return "idle"
