"""
Service for building drone API responses.
Centralizes calculation logic for derived fields (autonomy, battery status, active mission).
"""
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session

from backend.models.drone import Drone
from backend.services.battery_service import estimate_range_km, get_battery_status
from backend.services import mission_service


def build_drone_detail(drone: Drone, db: Session) -> Dict[str, Any]:
    """
    Builds a complete dict for a Drone object, including:
    - database fields
    - calculated fields: estimated_range_km, battery_status
    - current active mission (if exists)

    Used by GET /drones/ and GET /drones/{id}.
    """
    batt_pct = float(drone.battery) if drone.battery is not None else 0.0
    batt_health = float(drone.battery_health) if drone.battery_health is not None else 100.0
    max_wh = float(drone.max_battery_wh) if drone.max_battery_wh is not None else 500.0
    weight = float(drone.weight_kg) if drone.weight_kg is not None else 3.5
    eff = float(drone.motor_efficiency) if drone.motor_efficiency is not None else 0.92

    range_km = estimate_range_km(batt_pct, max_wh, batt_health, weight, eff)
    batt_status = get_battery_status(batt_pct, batt_health)

    detail: Dict[str, Any] = {
        "id": drone.id,
        "name": drone.name,
        "latitude": drone.latitude,
        "longitude": drone.longitude,
        "battery": round(batt_pct, 1),
        "status": drone.status,
        "route_path": drone.route_path,
        "planned_route_path": drone.planned_route_path,
        "route_index": drone.route_index,
        "dest_latitude": drone.dest_latitude,
        "dest_longitude": drone.dest_longitude,
        "battery_health": round(batt_health, 1),
        "max_battery_wh": max_wh,
        "total_flight_km": round(float(drone.total_flight_km or 0), 1),
        "total_charge_cycles": int(drone.total_charge_cycles or 0),
        "estimated_range_km": round(range_km, 1),
        "battery_status": batt_status,
        "weight_kg": weight,
        "motor_efficiency": eff,

        "mission_id": None,
        "mission_progress_pct": None,
        "mission_remaining_km": None,
        "mission_remaining_duration_h": None,
        "mission_status": None,
    }

    mission = mission_service.get_active_mission_for_drone(db, drone.id)
    if mission:
        detail.update({
            "mission_id": mission.id,
            "mission_progress_pct": mission.progress_pct,
            "mission_remaining_km": mission.remaining_km,
            "mission_remaining_duration_h": mission.remaining_duration_h,
            "mission_status": mission.status,
        })

        if mission.delivery:
            detail.update({
                "pickup_lat": mission.delivery.pickup_lat,
                "pickup_lon": mission.delivery.pickup_lon,
                "dest_lat": mission.delivery.dest_lat,
                "dest_lon": mission.delivery.dest_lon,
                "delivery_id": mission.delivery.id,
                "delivery_priority": mission.delivery.priority,
                "delivery_package_type": mission.delivery.package_type,
                "pickup_waypoint_index": mission.pickup_waypoint_index,
            })

    return detail
