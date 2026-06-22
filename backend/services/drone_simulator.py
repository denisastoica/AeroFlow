"""
Flight simulator for drones: step-by-step movement on route, battery consumption.
Drones can charge ONLY at fixed stations. When running low on battery, it goes to
the nearest station, charges, then resumes the mission.
"""
import threading
import time
import logging
from datetime import datetime
from typing import List, Optional, Tuple
import json

logger = logging.getLogger(__name__)

from backend.database import SessionLocal
from backend.models.drone import Drone
from backend.models.delivery import Delivery
from backend.models.mission import Mission
from backend.schemas import drone
from backend.schemas import mission
from backend.services.grid import city_grid, haversine_distance
from backend.services.charging_stations import (
    get_nearest_station,
    get_optimal_station,
    MAX_AUTONOMY_KM,
    CHARGING_STATIONS as _CHARGING_STATIONS_TOP,
)
from backend.services.routing_utils import plan_route_leg
from backend.app.core.delivery_state import DeliveryStatus, MissionStatus, ACTIVE_DELIVERY_STATUSES
from backend.services import mission_service
from backend.services import mission_event_service
from backend.services.weather_service import get_weather_impact_at
from backend.services import alert_service
from backend.services.battery_service import (
    compute_battery_drain_pct,
    apply_charge_step,
    apply_degradation,
    apply_flight_degradation,
    estimate_range_km,
    get_battery_status,
    BATTERY_RESERVE_PCT,
)
from backend.services.no_fly_zone_service import get_blocked_cells


STEP_INTERVAL_SEC = 0.5
MIN_BATTERY_TO_FLY = 10
BATTERY_BUFFER = 0.15
STATION_RADIUS_KM = 1.0
MAX_CHARGING_STOPS = 25


_ws_manager = None


SIM_DRONE_SPEED_KM_PER_TICK = 2.0

def _move_along_route(drone, path, idx, step_km):
    """
    Advance drone position along *path* by *step_km*.
    Returns (new_idx, total_distance_moved_km, waypoints).
    waypoints is the list of [lat, lon] positions traversed this tick,
    starting with the drone's position BEFORE the move.
    Drone lat/lon are updated **in-place**.
    """
    total_moved = 0.0
    skipped_zero = False

    waypoints = [[float(drone.latitude), float(drone.longitude)]]
    while step_km > 1e-6 and idx < len(path) - 1:
        nx, ny = float(path[idx + 1][0]), float(path[idx + 1][1])
        seg = _haversine_km(float(drone.latitude), float(drone.longitude), nx, ny)
        if seg < 1e-6:

            drone.latitude = nx
            drone.longitude = ny
            idx += 1
            skipped_zero = True
            continue
        if seg <= step_km:

            drone.latitude = nx
            drone.longitude = ny
            step_km -= seg
            total_moved += seg
            idx += 1
            waypoints.append([float(nx), float(ny)])
        else:

            frac = step_km / seg
            drone.latitude = float(drone.latitude) + (nx - float(drone.latitude)) * frac
            drone.longitude = float(drone.longitude) + (ny - float(drone.longitude)) * frac
            total_moved += step_km
            step_km = 0

    final = [float(drone.latitude), float(drone.longitude)]
    if abs(final[0] - waypoints[-1][0]) > 1e-9 or abs(final[1] - waypoints[-1][1]) > 1e-9:
        waypoints.append(final)


    if total_moved < 1e-7 and (skipped_zero or idx > drone.route_index):
        total_moved = 1e-4
    return idx, total_moved, waypoints


def _complete_delivery(db, drone: Drone):
    """Mark delivery as delivered when drone reaches destination."""
    drone.route_path = None
    drone.route_index = 0
    drone.dest_latitude = None
    drone.dest_longitude = None
    drone.status = "idle"
    drone.stuck_steps = 0
    drone.charge_count = 0


    active_del = db.query(Delivery).filter(
        Delivery.drone_id == drone.id,
        Delivery.status.in_(list(ACTIVE_DELIVERY_STATUSES))
    ).first()

    if active_del:

        dist_to_dest = 0.0
        if active_del.dest_lat and active_del.dest_lon and drone.latitude and drone.longitude:
            dist_to_dest = _haversine_km(
                float(drone.latitude), float(drone.longitude),
                float(active_del.dest_lat), float(active_del.dest_lon),
            )
        distance_m = dist_to_dest * 1000.0


        from backend.services.weather_service import get_weather_at
        weather = get_weather_at(float(active_del.dest_lat), float(active_del.dest_lon))
        weather_condition = weather.get("condition", "clear")
        can_fly = weather.get("can_fly", True)


        if not can_fly or weather_condition == "storm":
            dropoff_weather_status = "unsafe"
            weather_safe_to_land = False
        elif weather_condition in ["rain", "heavy_rain", "snow"]:
            dropoff_weather_status = "warning"
            weather_safe_to_land = True
        else:
            dropoff_weather_status = "safe"
            weather_safe_to_land = True


        battery_safe = (drone.battery or 0.0) >= 12.0


        code_required = "Yes" if active_del.confirmation_code else "No"


        is_safe = True
        reason = None

        if distance_m > 100.0:
            is_safe = False
            reason = "position mismatch"
        elif not weather_safe_to_land:
            is_safe = False
            reason = "weather unsafe"
        elif not battery_safe:
            is_safe = False
            reason = "low battery"


        active_del.dropoff_safety_status = "passed" if is_safe else "failed"
        active_del.dropoff_safety_reason = reason
        active_del.dropoff_weather_safe = dropoff_weather_status
        active_del.dropoff_battery_pct = float(drone.battery or 0.0)
        active_del.dropoff_distance_m = float(distance_m)
        active_del.dropoff_code_required = code_required
        db.flush()

        if is_safe:

            if active_del.status in ("assigned", "picking_up", "picked_up"):
                active_del.status = "in_transit"
                db.flush()

            from backend.services.delivery_service import mark_delivery_as_delivered
            if mark_delivery_as_delivered(db, active_del.id):
                print(f"[Simulator] Delivery #{active_del.id} COMPLETED by drone #{drone.id}")
                _broadcast_delivery_update(db, active_del.id)
            else:
                print(f"[Simulator] Failed to mark delivery #{active_del.id} as delivered "
                      f"(status={active_del.status})")
        else:

            active_del.status = "failed"
            if reason == "weather unsafe":
                active_del.failure_reason = "unsafe_dropoff_weather"
            elif reason == "low battery":
                active_del.failure_reason = "unsafe_dropoff_low_battery"
            elif reason == "position mismatch":
                active_del.failure_reason = "unsafe_dropoff_position_mismatch"
            else:
                active_del.failure_reason = f"unsafe_dropoff_{reason.replace(' ', '_')}"
            db.flush()


            from backend.services.alert_service import create_alert
            details = f"Weather: {dropoff_weather_status.capitalize()}, Wind: {weather.get('wind_speed', 0):.1f}km/h, Battery: {drone.battery:.1f}%, Distance: {distance_m:.1f}m"
            create_alert(
                db,
                alert_type="DELIVERY_FAILED",
                message=f"Unsafe drop-off conditions for delivery #{active_del.id}: {reason}",
                severity="critical",
                drone_id=drone.id,
                delivery_id=active_del.id,
                details=details,
            )
            print(f"[Simulator] Delivery #{active_del.id} BLOCKED at destination due to unsafe drop-off: {reason}")
            _broadcast_delivery_update(db, active_del.id)
    else:
        print(f"[Simulator] Drone #{drone.id} reached endpoint, but no active delivery found.")

    db.commit()
    _broadcast_drone_update(drone, None)


def _get_ws_manager():
    """Get WebSocket manager lazily (avoid circular imports)"""
    global _ws_manager
    if _ws_manager is None:
        try:
            from backend.routes.ws import manager
            _ws_manager = manager
        except Exception as e:
            print(f"[Simulator] Failed to import WS manager: {e}")
    return _ws_manager


def _broadcast_drone_update(drone: Drone, mission=None, path_segment=None):
    """Queue drone update for broadcast via WebSocket (thread-safe, non-blocking)"""
    try:
        manager = _get_ws_manager()
        if not manager or not manager.active_connections:
            return


        _speed_mult = 1.0
        _bat_mult = 1.0
        if drone.latitude is not None and drone.longitude is not None:
            try:
                _wx = get_weather_impact_at(float(drone.latitude), float(drone.longitude))
                _speed_mult = max(0.1, _wx.get("speed_multiplier", 1.0))
                _bat_mult = max(0.1, _wx.get("battery_multiplier", 1.0))
            except Exception:
                pass


        _display_speed = 0.0
        if drone.status in ("in_mission", "going_to_charging"):
            try:
                from backend.services.battery_service import compute_effective_speed
                drone_weight = float(drone.weight_kg) if drone.weight_kg is not None else 3.5
                payload_weight = 0.0
                if mission and hasattr(mission, "delivery") and mission.delivery and mission.delivery.weight_kg is not None:
                    payload_weight = float(mission.delivery.weight_kg)
                

                base_speed = compute_effective_speed(drone_weight + payload_weight, _speed_mult)
                

                import random
                _display_speed = round(max(5.0, base_speed + random.uniform(-1.2, 1.2)), 1)
            except Exception:
                _display_speed = round(60.0 * _speed_mult, 1)


        update = {
            "type": "drone_update",
            "drone_id": drone.id,
            "name": drone.name,
            "latitude": float(drone.latitude) if drone.latitude is not None else None,
            "longitude": float(drone.longitude) if drone.longitude is not None else None,
            "battery": round(float(drone.battery), 1) if drone.battery is not None else 0,
            "status": drone.status,
            "route_path": (
                json.loads(drone.route_path) if isinstance(drone.route_path, str)
                else drone.route_path
            ) if drone.route_path else None,
            "planned_route_path": (
                json.loads(drone.planned_route_path) if isinstance(drone.planned_route_path, str)
                else drone.planned_route_path
            ) if drone.planned_route_path else None,
            "route_index": int(drone.route_index) if drone.route_index else 0,

            "battery_health": round(float(drone.battery_health), 1) if drone.battery_health is not None else 100,
            "total_flight_km": round(float(drone.total_flight_km), 1) if drone.total_flight_km else 0,
            "total_charge_cycles": int(drone.total_charge_cycles) if drone.total_charge_cycles else 0,
            "estimated_range_km": round(estimate_range_km(
                float(drone.battery) if drone.battery else 0,
                float(drone.max_battery_wh) if drone.max_battery_wh else 500,
                float(drone.battery_health) if drone.battery_health else 100,
                float(drone.weight_kg) if drone.weight_kg else 3.5,
                float(drone.motor_efficiency) if drone.motor_efficiency else 0.92,
                weather_battery_mult=_bat_mult,
            ), 1),

            "speed": _display_speed,
        }


        if mission:
            update.update({
                "mission_id": mission.id,
                "mission_progress_pct": float(mission.progress_pct) if mission.progress_pct else 0,
                "mission_remaining_km": float(mission.remaining_km) if mission.remaining_km else None,
                "mission_remaining_duration_h": float(mission.remaining_duration_h) if mission.remaining_duration_h else None,
                "mission_status": mission.status,
            })

            try:
                if mission.delivery:
                    update["pickup_lat"] = float(mission.delivery.pickup_lat) if mission.delivery.pickup_lat else None
                    update["pickup_lon"] = float(mission.delivery.pickup_lon) if mission.delivery.pickup_lon else None
                    update["dest_lat"] = float(mission.delivery.dest_lat) if mission.delivery.dest_lat else None
                    update["dest_lon"] = float(mission.delivery.dest_lon) if mission.delivery.dest_lon else None
                    update["delivery_id"] = int(mission.delivery.id)
            except Exception:
                pass


            remaining_km = float(mission.remaining_km) if mission.remaining_km else 0
            effective_speed_km_per_tick = SIM_DRONE_SPEED_KM_PER_TICK * _speed_mult
            if remaining_km > 0 and effective_speed_km_per_tick > 0:
                update["eta_minutes"] = round(remaining_km / effective_speed_km_per_tick / 60, 1)
            else:
                update["eta_minutes"] = 0


            if drone.status == "going_to_charging" and drone.route_path:
                from backend.services.charging_stations import get_nearest_station
                last_pt = drone.route_path[-1]
                st = get_nearest_station(last_pt[0], last_pt[1])
                update["current_target_type"] = "charging"
                update["current_target_name"] = st[2] if st else "Charging Station"
                if st:
                    update["target_lat"] = float(st[0])
                    update["target_lon"] = float(st[1])
            elif mission.status == MissionStatus.EN_ROUTE_PICKUP.value:
                update["current_target_type"] = "pickup"
                update["current_target_name"] = "Pickup Point"
                update["target_lat"] = update.get("pickup_lat")
                update["target_lon"] = update.get("pickup_lon")
            elif mission.status in (MissionStatus.EN_ROUTE_DELIVERY.value, MissionStatus.IN_PROGRESS.value):
                update["current_target_type"] = "destination"
                update["current_target_name"] = "Final Destination"
                update["target_lat"] = update.get("dest_lat")
                update["target_lon"] = update.get("dest_lon")
            else:
                update["current_target_type"] = "idle"
                update["current_target_name"] = "Waiting"
        else:

            update.update({
                "mission_id": None,
                "mission_status": "idle",
                "delivery_id": None,
                "pickup_lat": None,
                "pickup_lon": None,
                "dest_lat": None,
                "dest_lon": None,
                "eta_minutes": 0,
                "mission_progress_pct": 0,
                "current_target_type": "idle",
                "current_target_name": "Idle",
            })
        

        if drone.latitude is not None and drone.longitude is not None:
            try:
                from backend.services.weather_service import get_weather_at
                weather_full = get_weather_at(float(drone.latitude), float(drone.longitude))
                update["weather"] = {
                    "condition": weather_full.get("condition", "clear"),
                    "condition_label": weather_full.get("condition_label", "Clear"),
                    "condition_icon": weather_full.get("condition_icon", "☀️"),
                    "temperature": weather_full.get("temperature", 20.0),
                    "wind_speed": weather_full.get("wind_speed", 0),
                    "wind_direction": weather_full.get("wind_direction", "N"),
                    "humidity": weather_full.get("humidity", 50),
                    "visibility_km": weather_full.get("visibility_km", 10),
                    "speed_multiplier": round(weather_full.get("speed_multiplier", 1.0), 2),
                    "battery_multiplier": round(weather_full.get("battery_multiplier", 1.0), 2),
                    "can_fly": weather_full.get("can_fly", True),
                    "warning": weather_full.get("warning"),
                    "zone_name": weather_full.get("zone_name", ""),
                    "api_description": weather_full.get("api_description", ""),
                    "source": weather_full.get("source", ""),
                }
            except Exception:
                pass
        

        if path_segment and len(path_segment) >= 2:
            update["path_segment"] = path_segment


        manager.queue_broadcast(update)
    except Exception as e:
        logger.debug("WS drone broadcast failed: %s", e)


def _broadcast_delivery_update(db, delivery_id: int):
    """Query delivery status and broadcast update via WebSocket"""
    try:
        manager = _get_ws_manager()
        if not manager or not manager.active_connections:
            return
        

        delivery = db.query(Delivery).filter(Delivery.id == delivery_id).first()
        if not delivery:
            return
        

        update = {
            "type": "delivery_update",
            "delivery_id": int(delivery.id),
            "customer_id": int(delivery.customer_id) if delivery.customer_id else None,
            "status": delivery.status,
            "drone_id": int(delivery.drone_id) if delivery.drone_id else None,
            "pickup_lat": float(delivery.pickup_lat) if delivery.pickup_lat else 0,
            "pickup_lon": float(delivery.pickup_lon) if delivery.pickup_lon else 0,
            "dest_lat": float(delivery.dest_lat) if delivery.dest_lat else 0,
            "dest_lon": float(delivery.dest_lon) if delivery.dest_lon else 0,
            "priority": delivery.priority,
            "package_type": delivery.package_type,
            "estimated_distance_km": float(delivery.estimated_distance_km) if delivery.estimated_distance_km else None,
            "completed_at": delivery.completed_at.isoformat() if delivery.completed_at else None,
            "confirmed_at": delivery.confirmed_at.isoformat() if delivery.confirmed_at else None,
        }


        if delivery.drone_id:
            drone = db.query(Drone).filter(Drone.id == delivery.drone_id).first()
            if drone:
                update["drone_lat"] = float(drone.latitude) if drone.latitude is not None else None
                update["drone_lon"] = float(drone.longitude) if drone.longitude is not None else None
                update["drone_battery"] = round(float(drone.battery), 1) if drone.battery is not None else 0
                update["drone_status"] = drone.status
                update["route_path"] = (
                    json.loads(drone.route_path) if isinstance(drone.route_path, str)
                    else drone.route_path
                ) if drone.route_path else None
                update["route_index"] = int(drone.route_index) if drone.route_index else 0
                

                if drone.latitude is not None and drone.longitude is not None:
                    try:
                        from backend.services.weather_service import get_weather_at
                        w = get_weather_at(float(drone.latitude), float(drone.longitude))
                        update["weather"] = {
                            "condition": w.get("condition", "clear"),
                            "condition_label": w.get("condition_label", "Clear"),
                            "condition_icon": w.get("condition_icon", "☀️"),
                            "temperature": w.get("temperature", 20.0),
                            "wind_speed": w.get("wind_speed", 0),
                            "wind_direction": w.get("wind_direction", "N"),
                            "humidity": w.get("humidity", 50),
                            "visibility_km": w.get("visibility_km", 10),
                            "speed_multiplier": round(w.get("speed_multiplier", 1.0), 2),
                            "battery_multiplier": round(w.get("battery_multiplier", 1.0), 2),
                            "can_fly": w.get("can_fly", True),
                            "warning": w.get("warning"),
                            "zone_name": w.get("zone_name", ""),
                            "api_description": w.get("api_description", ""),
                            "source": w.get("source", ""),
                        }
                    except Exception:
                        pass
        

            mission = db.query(Mission).filter(
                Mission.delivery_id == delivery.id,
                Mission.end_time == None,
            ).order_by(Mission.start_time.desc()).first()
            if mission:
                update["progress_pct"] = round(float(mission.progress_pct), 1) if mission.progress_pct else 0
                update["remaining_km"] = round(float(mission.remaining_km), 2) if mission.remaining_km else None
                update["remaining_duration_h"] = round(float(mission.remaining_duration_h), 4) if mission.remaining_duration_h else None
                update["mission_status"] = mission.status


                _del_speed_mult = 1.0
                if drone and drone.latitude is not None and drone.longitude is not None:
                    try:
                        _del_wx = get_weather_impact_at(float(drone.latitude), float(drone.longitude))
                        _del_speed_mult = max(0.1, _del_wx.get("speed_multiplier", 1.0))
                    except Exception:
                        pass
                _eff_spd = SIM_DRONE_SPEED_KM_PER_TICK * _del_speed_mult
                if mission.remaining_km_to_pickup is not None:
                    update["remaining_km_to_pickup"] = round(float(mission.remaining_km_to_pickup), 3)
                    update["eta_sim_s_to_pickup"] = round(mission.remaining_km_to_pickup / max(0.001, _eff_spd))
                if mission.remaining_km_to_destination is not None:
                    update["remaining_km_to_destination"] = round(float(mission.remaining_km_to_destination), 3)
                    update["eta_sim_s_to_destination"] = round(mission.remaining_km_to_destination / max(0.001, _eff_spd))
        
        manager.queue_broadcast(update)
    except Exception as e:
        logger.debug("WS delivery broadcast failed: %s", e)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance between two points in km."""
    return haversine_distance(lat1, lon1, lat2, lon2)


def _path_total_km(path: List[List[float]]) -> float:
    """Total route distance in km."""
    total = 0
    for i in range(len(path) - 1):
        total += _haversine_km(
            path[i][0], path[i][1],
            path[i + 1][0], path[i + 1][1],
        )
    return total


def _is_at_station(lat: float, lon: float) -> bool:
    """Checks if the drone is near a charging station."""
    station = get_nearest_station(lat, lon)
    if not station:
        return False
    dist = _haversine_km(lat, lon, station[0], station[1])
    return dist <= STATION_RADIUS_KM


def _ensure_route_continues_after_pickup(db, drone: Drone, delivery: Delivery, mission: Mission | None) -> bool:
    """
    Safety fix: if the drone reached pickup but the current route ends there,
    append a route from pickup to destination so it can continue the mission.
    Returns True if the route was modified.
    """
    if not delivery or not drone.route_path:
        return False

    if delivery.status not in (
        DeliveryStatus.PICKED_UP.value,
        DeliveryStatus.IN_TRANSIT.value,
        DeliveryStatus.IN_PROGRESS.value,
    ):
        return False

    path = drone.route_path
    if not isinstance(path, list) or len(path) < 2:
        return False

    last = path[-1]
    dist_last_to_dest = _haversine_km(
        float(last[0]), float(last[1]),
        float(delivery.dest_lat), float(delivery.dest_lon),
    )

    if dist_last_to_dest <= 1.0:
        return False

    dist_last_to_pickup = _haversine_km(
        float(last[0]), float(last[1]),
        float(delivery.pickup_lat), float(delivery.pickup_lon),
    )

    if dist_last_to_pickup > 2.0:
        return False

    blocked = get_blocked_cells(city_grid)
    route_pickup_dest = plan_route_leg(
        float(delivery.pickup_lat), float(delivery.pickup_lon),
        float(delivery.dest_lat), float(delivery.dest_lon),
        blocked,
    )

    if not route_pickup_dest or len(route_pickup_dest) < 2:
        _fail_mission(db, drone, "Could not extend route from pickup to destination")
        return False

    current_idx = int(drone.route_index or 0)

    drone.route_path = path[: current_idx + 1] + [[p[0], p[1]] for p in route_pickup_dest[1:]]
    drone.planned_route_path = drone.planned_route_path or drone.route_path
    drone.route_index = min(current_idx, len(drone.route_path) - 2)

    if mission:
        mission.status = MissionStatus.EN_ROUTE_DELIVERY.value
        mission.pickup_waypoint_index = min(current_idx, len(drone.route_path) - 2)

    drone.dest_latitude = float(delivery.dest_lat)
    drone.dest_longitude = float(delivery.dest_lon)

    db.commit()
    _broadcast_drone_update(drone, mission)

    return True


def _step_drone(db, drone: Drone) -> int:
    """
    Advances the drone by one step on the route (interpolated: SIM_DRONE_SPEED_KM_PER_TICK km/tick).
    Status: in_mission, going_to_charging
    """

    if drone.status in ("in_mission", "going_to_charging") and not drone.route_path:
        logger.warning(
            f"[Simulator] Drone #{drone.id} has status='{drone.status}' but no route_path — failing mission."
        )
        _fail_mission(db, drone, f"No route found for drone in status '{drone.status}'")
        return 1

    active_del = db.query(Delivery).filter(
        Delivery.drone_id == drone.id,
        Delivery.status.in_(list(ACTIVE_DELIVERY_STATUSES))
    ).order_by(Delivery.created_at.desc()).first()


    if active_del and active_del.notes and "motor failure" in active_del.notes and "(resolved)" not in active_del.notes:
        import re
        from datetime import datetime
        m = re.search(r"fail_timer=([\d\.]+)", active_del.notes)
        if m:

            timer_start = float(m.group(1))
            if datetime.now().timestamp() - timer_start > 10:
                active_del.notes += " (resolved)"
                db.commit()
                _fail_mission(db, drone, "Simulated motor failure for reassignment demo")
                return 1
        elif getattr(drone, "charge_count", 0) >= 1 and drone.status in ("in_mission", "going_to_charging"):


            active_del.notes += f" fail_timer={datetime.now().timestamp()}"
            db.commit()


    if drone.status == "in_mission" and drone.route_path:
        path: List[List[float]] = drone.route_path
        idx = drone.route_index or 0


        if active_del and idx + 1 < len(path):
            weather_impact = get_weather_impact_at(float(drone.latitude), float(drone.longitude))
            battery_multiplier = weather_impact.get("battery_multiplier", 1.0)

            range_km = estimate_range_km(
                battery_pct=float(drone.battery),
                max_battery_wh=float(drone.max_battery_wh or 500),
                battery_health=float(drone.battery_health or 100),
                weight_kg=float(drone.weight_kg or 3.5),
                motor_efficiency=float(drone.motor_efficiency or 0.92),
                weather_battery_mult=battery_multiplier,
            )


            next_wp_lat = float(path[idx + 1][0])
            next_wp_lon = float(path[idx + 1][1])
            dist_to_next_wp = _haversine_km(
                float(drone.latitude), float(drone.longitude),
                next_wp_lat, next_wp_lon,
            ) * 1.15

            if dist_to_next_wp > range_km:

                from backend.services.charging_stations import find_station_chain


                if active_del.status in (DeliveryStatus.ASSIGNED.value, DeliveryStatus.PICKING_UP.value):
                    chain_target_lat = float(active_del.pickup_lat)
                    chain_target_lon = float(active_del.pickup_lon)
                else:
                    chain_target_lat = float(active_del.dest_lat)
                    chain_target_lon = float(active_del.dest_lon)

                full_range_km = estimate_range_km(
                    battery_pct=100.0,
                    max_battery_wh=float(drone.max_battery_wh or 500),
                    battery_health=float(drone.battery_health or 100),
                    weight_kg=float(drone.weight_kg or 3.5),
                    motor_efficiency=float(drone.motor_efficiency or 0.92),
                    weather_battery_mult=battery_multiplier,
                )

                chain = find_station_chain(
                    float(drone.latitude), float(drone.longitude),
                    chain_target_lat, chain_target_lon,
                    first_leg_km=range_km,
                    full_leg_km=full_range_km,
                )

                if chain is None:
                    _fail_mission(db, drone, "Pre-flight: No reachable charging station before next waypoint")
                    return 1

                if len(chain) > 0:
                    from backend.services.grid import haversine_distance
                    station = chain[0]
                    if haversine_distance(float(drone.latitude), float(drone.longitude), station[0], station[1]) < 0.1:
                        if drone.battery < 99.0:

                            drone.status = "charging"
                            drone.battery = max(0, drone.battery)
                            db.commit()
                            _broadcast_drone_update(drone, mission_service.get_active_mission_for_drone(db, drone.id))
                            return 1
                        elif len(chain) > 1:
                            station = chain[1]
                        else:
                            _fail_mission(db, drone, "Cannot make forward progress; stuck at charging station")
                            return 1
                            
                    blocked = get_blocked_cells(city_grid)
                    route_to_station = plan_route_leg(
                        float(drone.latitude), float(drone.longitude),
                        station[0], station[1],
                        blocked_cells=blocked,
                    )

                    if len(route_to_station) < 2:
                        _fail_mission(db, drone, "Pre-flight: No safe route to first charging station")
                        return 1

                    drone.route_path = [[p[0], p[1]] for p in route_to_station]
                    drone.route_index = 0

                    print("=== ROUTE ASSIGNED TO CHARGING (PRE-FLIGHT) ===")
                    print("Drone:", drone.id, drone.name)
                    print("Route points:", len(drone.route_path))
                    print("Start:", drone.route_path[0])
                    print("End:", drone.route_path[-1])

                    drone.status = "going_to_charging"
                    db.commit()

                    _broadcast_drone_update(drone, mission_service.get_active_mission_for_drone(db, drone.id))
                    return 1


        if idx >= len(path) - 1:
            _complete_delivery(db, drone)
            return 1


        weather_impact = get_weather_impact_at(float(drone.latitude), float(drone.longitude))
        battery_multiplier = weather_impact.get("battery_multiplier", 1.0)
        speed_multiplier = weather_impact.get("speed_multiplier", 1.0)
        can_fly = weather_impact.get("can_fly", True)


        if not can_fly:
            drone.stuck_steps = (drone.stuck_steps or 0) + 1
            if drone.stuck_steps > 60:
                _fail_mission(db, drone, "Extended storm - mission cancelled")
            else:
                if drone.stuck_steps == 1:
                    mission = db.query(Mission).filter(
                        Mission.drone_id == drone.id,
                        Mission.status.in_([
                            MissionStatus.EN_ROUTE_PICKUP.value,
                            MissionStatus.EN_ROUTE_DELIVERY.value,
                            MissionStatus.IN_PROGRESS.value,
                        ]),
                    ).first()
                    if mission:
                        mission_event_service.log_event(
                            db, mission.id, "WEATHER_HOLD",
                            f"Flight suspended: {weather_impact.get('warning', 'Severe weather conditions')}"
                        )
                    warning_msg = weather_impact.get("warning", "Severe weather conditions")
                    alert_service.alert_weather_grounded(db, drone, warning_msg)

                hover_drain = max(0.02, compute_battery_drain_pct(
                    distance_km=0,
                    max_battery_wh=float(drone.max_battery_wh or 500),
                    battery_health=float(drone.battery_health or 100),
                    weight_kg=float(drone.weight_kg or 3.5),
                    motor_efficiency=float(drone.motor_efficiency or 0.92),
                    weather_battery_mult=battery_multiplier,
                ) * 0.4)
                drone.battery = round(max(0, drone.battery - hover_drain), 1)
                db.commit()
                _broadcast_drone_update(drone, mission_service.get_active_mission_for_drone(db, drone.id))
            return 1


        if drone.stuck_steps is None:
            drone.stuck_steps = 0


        step_km = SIM_DRONE_SPEED_KM_PER_TICK * max(0.1, speed_multiplier)
        idx, dist_moved, tick_waypoints = _move_along_route(drone, path, idx, step_km)
        drone.route_index = idx

        if dist_moved < 1e-7:


            if idx >= len(path) - 1:
                drone.stuck_steps = 0
                db.commit()
                return 1

            drone.stuck_steps = (drone.stuck_steps or 0) + 1
            if drone.stuck_steps > 45:
                alert_service.alert_drone_stuck(db, drone, drone.stuck_steps)
                _fail_mission(db, drone, f"Stuck - no progress for {drone.stuck_steps}s")
            return 1
        else:

            drone.stuck_steps = 0


        battery_used = compute_battery_drain_pct(
            distance_km=dist_moved,
            max_battery_wh=float(drone.max_battery_wh or 500),
            battery_health=float(drone.battery_health or 100),
            weight_kg=float(drone.weight_kg or 3.5),
            motor_efficiency=float(drone.motor_efficiency or 0.92),
            weather_battery_mult=battery_multiplier,
        )
        battery_used = max(0.02, battery_used)
        new_battery = max(0, drone.battery - battery_used)


        drone.battery_health = apply_flight_degradation(
            float(drone.battery_health or 100), dist_moved
        )
        drone.total_flight_km = (drone.total_flight_km or 0) + dist_moved
        drone.battery = round(new_battery, 1)


        active_dels = db.query(Delivery).filter(
            Delivery.drone_id == drone.id,
            Delivery.status.in_(list(ACTIVE_DELIVERY_STATUSES))
        ).order_by(Delivery.created_at.desc()).all()
        
        if active_dels:

            active_del = active_dels[0]
            if len(active_dels) > 1:
                print(f"[Simulator] CRITICAL: Drone #{drone.id} has {len(active_dels)} concurrent assignments. Failing {len(active_dels)-1} older ones.")
                for other_del in active_dels[1:]:
                    other_del.status = DeliveryStatus.FAILED.value
                    other_del.failure_reason = "System conflict: multiple assignments"
                    mission = mission_service.get_active_mission_for_drone(db, drone.id)
                    if mission and mission.delivery_id == other_del.id:
                        mission.status = MissionStatus.FAILED.value
                db.commit()
                for other_del in active_dels[1:]:
                    mission_service.fail_mission(db, other_del.id, "System conflict: multiple assignments")
            mission = mission_service.get_active_mission_for_drone(db, drone.id)
            pickup_idx = mission.pickup_waypoint_index if mission else None

            if active_del.status == DeliveryStatus.ASSIGNED.value:

                active_del.status = DeliveryStatus.PICKING_UP.value
                if mission and mission.status in (MissionStatus.PLANNED.value, MissionStatus.PENDING.value):
                    mission.status = MissionStatus.EN_ROUTE_PICKUP.value
                from backend.services.delivery_service import log_delivery_event
                log_delivery_event(db, active_del, "PICKING_UP", f"Drone heading to pickup location from [{drone.latitude},{drone.longitude}]")

            elif active_del.status == DeliveryStatus.PICKING_UP.value:


                effective_pickup_idx = pickup_idx if pickup_idx is not None else max(1, len(path) // 2)
                if idx >= effective_pickup_idx:
                    active_del.status = DeliveryStatus.PICKED_UP.value
                    if mission:
                        mission.status = MissionStatus.AT_PICKUP.value
                    from backend.services.delivery_service import log_delivery_event
                    log_delivery_event(db, active_del, "PICKED_UP", "Package picked up at origin")


                    if _ensure_route_continues_after_pickup(db, drone, active_del, mission):

                        path = drone.route_path
                        idx = drone.route_index or 0

            elif active_del.status == DeliveryStatus.PICKED_UP.value:

                active_del.status = DeliveryStatus.IN_TRANSIT.value
                if mission and mission.status == MissionStatus.AT_PICKUP.value:
                    mission.status = MissionStatus.EN_ROUTE_DELIVERY.value

                from backend.services.delivery_service import log_delivery_event
                log_delivery_event(db, active_del, "IN_TRANSIT", "Package in transit to destination")


                _ensure_route_continues_after_pickup(db, drone, active_del, mission)


        mission_service.update_progress(db, drone)


        if idx >= len(path) - 1:
            db.commit()
            _complete_delivery(db, drone)
            return 1


        db.commit()


        range_km = estimate_range_km(
            battery_pct=float(drone.battery),
            max_battery_wh=float(drone.max_battery_wh or 500),
            battery_health=float(drone.battery_health or 100),
            weight_kg=float(drone.weight_kg or 3.5),
            motor_efficiency=float(drone.motor_efficiency or 0.92),
            weather_battery_mult=battery_multiplier,
        )

        if idx < len(path) - 1:
            dist_to_next = _haversine_km(drone.latitude, drone.longitude, path[idx+1][0], path[idx+1][1])
            remaining_route_km = dist_to_next + _path_total_km(path[idx+1:])
        else:
            remaining_route_km = 0.0

        needs_charge = False
        station = None

        if range_km < remaining_route_km * 0.95 and remaining_route_km > 0.5:


            _active_del_for_target = active_dels[0] if active_dels else None
            if (_active_del_for_target and _active_del_for_target.status in (
                DeliveryStatus.ASSIGNED.value, DeliveryStatus.PICKING_UP.value,
            )):
                eff_target_lat = float(_active_del_for_target.pickup_lat)
                eff_target_lon = float(_active_del_for_target.pickup_lon)
            else:

                if _active_del_for_target:
                    eff_target_lat = float(_active_del_for_target.dest_lat)
                    eff_target_lon = float(_active_del_for_target.dest_lon)
                else:
                    eff_target_lat = drone.dest_latitude or float(path[-1][0])
                    eff_target_lon = drone.dest_longitude or float(path[-1][1])


            dist_direct_to_target = _haversine_km(
                float(drone.latitude), float(drone.longitude),
                eff_target_lat, eff_target_lon,
            ) * 1.15


            if dist_direct_to_target > range_km:


                from backend.services.charging_stations import find_station_chain as _find_chain
                is_at_cur_station = _is_at_station(float(drone.latitude), float(drone.longitude))
                cur_st = get_nearest_station(float(drone.latitude), float(drone.longitude)) if is_at_cur_station else None

                full_range_km = estimate_range_km(
                    battery_pct=100.0,
                    max_battery_wh=float(drone.max_battery_wh or 500),
                    battery_health=float(drone.battery_health or 100),
                    weight_kg=float(drone.weight_kg or 3.5),
                    motor_efficiency=float(drone.motor_efficiency or 0.92),
                    weather_battery_mult=battery_multiplier,
                )

                chain = _find_chain(
                    float(drone.latitude), float(drone.longitude),
                    eff_target_lat, eff_target_lon,
                    first_leg_km=range_km,
                    full_leg_km=full_range_km,
                )

                if chain is None:
                    _fail_mission(db, drone, "No viable charging route to destination")
                    return 1

                station = None
                if chain:
                    for hop in chain:

                        if is_at_cur_station and cur_st and \
                                _haversine_km(hop[0], hop[1], float(cur_st[0]), float(cur_st[1])) < 0.5:
                            continue
                        d_to_hop = _haversine_km(float(drone.latitude), float(drone.longitude), hop[0], hop[1]) * 1.15
                        if d_to_hop <= range_km:
                            station = hop
                            break

                if station is not None:
                    needs_charge = True
                elif drone.battery <= BATTERY_RESERVE_PCT:

                    _fail_mission(db, drone, "Battery critically low with no reachable charging station")
                    return 1


        else:
            if drone.battery <= BATTERY_RESERVE_PCT:


                _fail_mission(db, drone, "Battery critically low before reaching destination")
                return 1

        if needs_charge:
            if not station:
                _fail_mission(db, drone, "No charging station available")
                return 1


            drone.charge_count = (drone.charge_count or 0) + 1
            if drone.charge_count > MAX_CHARGING_STOPS:
                _fail_mission(db, drone, f"Exceeded maximum charging stops ({MAX_CHARGING_STOPS})")
                return 1


            if not drone.dest_latitude:
                drone.dest_latitude = float(path[-1][0])
                drone.dest_longitude = float(path[-1][1])

            blocked = get_blocked_cells(city_grid)
            route_to_station = plan_route_leg(
                drone.latitude, drone.longitude,
                station[0], station[1],
                blocked_cells=blocked,
            )
            if len(route_to_station) < 2:
                _fail_mission(db, drone, "No safe route to station")
                return 1
            drone.route_path = [[p[0], p[1]] for p in route_to_station]
            drone.route_index = 0
            
            print("=== ROUTE ASSIGNED TO CHARGING (DETOUR) ===")
            print("Drone:", drone.id, drone.name)
            print("Route points:", len(drone.route_path))
            print("Start:", drone.route_path[0])
            print("End:", drone.route_path[-1])
            print("Full route:", drone.route_path)

            drone.status = "going_to_charging"

            db.commit()


            try:
                if active_dels:
                    from backend.services.delivery_service import log_delivery_event
                    _log_del = active_dels[0]
                    log_delivery_event(db, _log_del, "DETOUR", f"Detouring to station (Battery: {drone.battery}%)")
                    db.commit()
            except Exception:
                db.rollback()


            mission = mission_service.get_active_mission_for_drone(db, drone.id)
            _broadcast_drone_update(drone, mission)

            return 1


        alert_service.alert_low_battery(db, drone)

        db.commit()


        mission = mission_service.get_active_mission_for_drone(db, drone.id)
        _broadcast_drone_update(drone, mission, path_segment=tick_waypoints)


        active_delivery = db.query(Delivery).filter(
            Delivery.drone_id == drone.id,
            Delivery.status.in_(list(ACTIVE_DELIVERY_STATUSES))
        ).first()
        if active_delivery:
            _broadcast_delivery_update(db, active_delivery.id)

        return 1


    elif drone.status == "going_to_charging" and drone.route_path:
        path = drone.route_path
        idx = drone.route_index or 0

        if idx >= len(path) - 1:

            station = get_nearest_station(drone.latitude, drone.longitude)
            if station:
                drone.latitude, drone.longitude = station[0], station[1]
            drone.route_path = None
            drone.route_index = 0
            drone.status = "charging"
            drone.battery = max(0, drone.battery)
            drone.stuck_steps = 0
            db.commit()


            mission = None
            try:
                mission = mission_service.get_active_mission_for_drone(db, drone.id)
                if mission:
                    mission.status = MissionStatus.CHARGING.value
                    mission_event_service.log_event(db, mission.id, "CHARGE", f"Started charging at station [{drone.latitude},{drone.longitude}]")
                    db.commit()
            except Exception:
                db.rollback()
                mission = None

            _broadcast_drone_update(drone, mission)
            return 1


        weather_impact = get_weather_impact_at(float(drone.latitude), float(drone.longitude))
        speed_multiplier = weather_impact.get("speed_multiplier", 1.0)
        battery_multiplier = weather_impact.get("battery_multiplier", 1.0)
        can_fly = weather_impact.get("can_fly", True)


        if not can_fly:
            drone.stuck_steps = (drone.stuck_steps or 0) + 1
            if drone.stuck_steps > 60:
                _fail_mission(db, drone, "Extended storm - mission cancelled")
            else:
                if drone.stuck_steps == 1:
                    mission = db.query(Mission).filter(
                        Mission.drone_id == drone.id,
                        Mission.status.in_([
                            MissionStatus.EN_ROUTE_PICKUP.value,
                            MissionStatus.EN_ROUTE_DELIVERY.value,
                            MissionStatus.IN_PROGRESS.value,
                        ]),
                    ).first()
                    if mission:
                        mission_event_service.log_event(
                            db, mission.id, "WEATHER_HOLD",
                            f"Flight suspended: {weather_impact.get('warning', 'Severe weather conditions')}"
                        )
                    warning_msg = weather_impact.get("warning", "Severe weather conditions")
                    alert_service.alert_weather_grounded(db, drone, warning_msg)

                hover_drain = max(0.02, compute_battery_drain_pct(
                    distance_km=0,
                    max_battery_wh=float(drone.max_battery_wh or 500),
                    battery_health=float(drone.battery_health or 100),
                    weight_kg=float(drone.weight_kg or 3.5),
                    motor_efficiency=float(drone.motor_efficiency or 0.92),
                    weather_battery_mult=battery_multiplier,
                ) * 0.4)
                drone.battery = round(max(0, drone.battery - hover_drain), 1)
                db.commit()
                _broadcast_drone_update(drone, mission_service.get_active_mission_for_drone(db, drone.id))
                return 1


        step_km = SIM_DRONE_SPEED_KM_PER_TICK * max(0.1, speed_multiplier)
        idx, dist_moved, tick_waypoints = _move_along_route(drone, path, idx, step_km)
        drone.route_index = idx

        if dist_moved < 1e-6:


            if idx >= len(path) - 1:
                drone.stuck_steps = 0
                db.commit()
                return 1

            drone.stuck_steps = (drone.stuck_steps or 0) + 1
            if drone.stuck_steps > 30:
                _fail_mission(db, drone, "Stuck en route to station")
            return 1
        else:
            drone.stuck_steps = 0


        if dist_moved > 0:
            battery_used = compute_battery_drain_pct(
                distance_km=dist_moved,
                max_battery_wh=float(drone.max_battery_wh or 500),
                battery_health=float(drone.battery_health or 100),
                weight_kg=float(drone.weight_kg or 3.5),
                motor_efficiency=float(drone.motor_efficiency or 0.92),
                weather_battery_mult=battery_multiplier,
            )
            drone.battery = round(max(0, drone.battery - battery_used), 1)
            drone.total_flight_km = (drone.total_flight_km or 0) + dist_moved
            drone.battery_health = apply_flight_degradation(float(drone.battery_health or 100), dist_moved)

            if drone.battery <= 0:
                _fail_mission(db, drone, "Battery depleted en route to charging station")
                return 1

        db.commit()
        mission = mission_service.get_active_mission_for_drone(db, drone.id)
        _broadcast_drone_update(drone, mission, path_segment=tick_waypoints)
        return 1

    return 0


def _charge_drone(db, drone: Drone) -> bool:
    """
    Charges the drone ONLY if it is at a charging station.
    After 100%, resumes mission to destination.
    """
    if drone.status != "charging":
        return False

    if not _is_at_station(drone.latitude, drone.longitude):

        station = get_nearest_station(float(drone.latitude), float(drone.longitude))
        if station:
            dist = _haversine_km(float(drone.latitude), float(drone.longitude), station[0], station[1])
            if dist <= 2.0:

                drone.latitude, drone.longitude = station[0], station[1]
                db.commit()
                return True

            blocked = get_blocked_cells(city_grid)
            recovery_route = plan_route_leg(
                float(drone.latitude), float(drone.longitude),
                station[0], station[1],
                blocked,
            )
            if len(recovery_route) >= 2:
                drone.route_path = [[p[0], p[1]] for p in recovery_route]
                drone.route_index = 0
                
                print("=== ROUTE ASSIGNED TO CHARGING (RECOVERY) ===")
                print("Drone:", drone.id, drone.name)
                print("Route points:", len(drone.route_path))
                print("Start:", drone.route_path[0])
                print("End:", drone.route_path[-1])
                print("Full route:", drone.route_path)

                drone.status = "going_to_charging"
                db.commit()
                return True

        _fail_mission(db, drone, "Charging drone too far from station — mission failed for reassignment")
        return True


    old_battery = float(drone.battery or 0)
    new_battery, wh_charged = apply_charge_step(
        battery_pct=old_battery,
        max_battery_wh=float(drone.max_battery_wh or 500),
        battery_health=float(drone.battery_health or 100),
        fast_charge=False,
    )
    drone.battery = new_battery
    

    if wh_charged > 0:
        new_health, new_cycles = apply_degradation(
            battery_health=float(drone.battery_health or 100),
            total_charge_cycles=int(drone.total_charge_cycles or 0),
            total_flight_km=float(drone.total_flight_km or 0),
            wh_charged=wh_charged,
            max_battery_wh=float(drone.max_battery_wh or 500),
            fast_charge=False,
        )
        drone.battery_health = new_health
        drone.total_charge_cycles = new_cycles

    if new_battery >= 99.5:

        active_del = db.query(Delivery).filter(
            Delivery.drone_id == drone.id,
            Delivery.status.in_(list(ACTIVE_DELIVERY_STATUSES))
        ).first()

        if not active_del:

            drone.status = "idle"
            drone.route_path = None
            drone.route_index = 0
            db.commit()
            return True

        past_pickup = active_del.status in (
            DeliveryStatus.PICKED_UP.value, DeliveryStatus.IN_TRANSIT.value,
            DeliveryStatus.IN_PROGRESS.value,
        )
        

        if not past_pickup:
            target_lat, target_lon = float(active_del.pickup_lat), float(active_del.pickup_lon)
            resume_mission_status = MissionStatus.EN_ROUTE_PICKUP
        else:
            target_lat, target_lon = float(active_del.dest_lat), float(active_del.dest_lon)
            resume_mission_status = MissionStatus.EN_ROUTE_DELIVERY

        blocked = get_blocked_cells(city_grid)
        

        weather_impact = get_weather_impact_at(float(drone.latitude), float(drone.longitude))
        battery_multiplier = weather_impact.get("battery_multiplier", 1.0)

        range_km = estimate_range_km(
            battery_pct=float(drone.battery),
            max_battery_wh=float(drone.max_battery_wh or 500),
            battery_health=float(drone.battery_health or 100),
            weight_kg=float(drone.weight_kg or 3.5),
            motor_efficiency=float(drone.motor_efficiency or 0.92),
            weather_battery_mult=battery_multiplier,
        )

        full_range_km = estimate_range_km(
            battery_pct=100.0,
            max_battery_wh=float(drone.max_battery_wh or 500),
            battery_health=float(drone.battery_health or 100),
            weight_kg=float(drone.weight_kg or 3.5),
            motor_efficiency=float(drone.motor_efficiency or 0.92),
            weather_battery_mult=battery_multiplier,
        )

        route = None
        status = "in_mission"


        direct_route = plan_route_leg(
            float(drone.latitude), float(drone.longitude),
            target_lat, target_lon,
            blocked,
        )
        
        is_reachable = False
        if direct_route and len(direct_route) >= 2:
            dist = _path_total_km(direct_route)
            if dist <= range_km:
                route = direct_route
                is_reachable = True

        if not is_reachable:

            from backend.services.charging_stations import find_station_chain
            chain = find_station_chain(
                float(drone.latitude), float(drone.longitude),
                target_lat, target_lon,
                first_leg_km=range_km,
                full_leg_km=full_range_km
            )
            
            if not chain:
                _fail_mission(db, drone, "Could not find a safe charging chain to resume mission")
                return True
                

            from backend.services.grid import haversine_distance
            station = chain[0]
            if haversine_distance(float(drone.latitude), float(drone.longitude), station[0], station[1]) < 0.1:
                if drone.battery < 99.0:

                    drone.status = "charging"
                    drone.battery = max(0, drone.battery)
                    db.commit()
                    _broadcast_drone_update(drone, mission_service.get_active_mission_for_drone(db, drone.id))
                    return True
                elif len(chain) > 1:
                    station = chain[1]
                else:
                    _fail_mission(db, drone, "Cannot make forward progress; stuck at charging station")
                    return True
                
            hop_route = plan_route_leg(
                float(drone.latitude), float(drone.longitude),
                station[0], station[1],
                blocked,
            )
            
            if not hop_route or len(hop_route) < 2:
                _fail_mission(db, drone, "Could not plan route to next charging hop")
                return True
                
            route = hop_route
            status = "going_to_charging"
            drone.charge_count = (drone.charge_count or 0) + 1


        final_route = [[p[0], p[1]] for p in route]
        p_idx = len(final_route) - 1

        if status == "in_mission" and not past_pickup:


            route_pickup_dest = plan_route_leg(
                float(active_del.pickup_lat), float(active_del.pickup_lon),
                float(active_del.dest_lat), float(active_del.dest_lon),
                blocked
            )
            if route_pickup_dest and len(route_pickup_dest) >= 2:
                final_route = final_route[:-1] + [[p[0], p[1]] for p in route_pickup_dest]
            else:


                _fail_mission(db, drone, "Cannot plan route from pickup to destination after charging (path blocked)")
                return True

        drone.route_path = final_route
        drone.route_index = 0
        
        print("=== ROUTE RESUMED AFTER CHARGING ===")
        print("Drone:", drone.id, drone.name)
        print("Route points:", len(drone.route_path))
        print("Start:", drone.route_path[0])
        print("End:", drone.route_path[-1])
        print("Full route:", drone.route_path)

        drone.status = status
        

        mission = mission_service.get_active_mission_for_drone(db, drone.id)
        if mission:
            mission.status = resume_mission_status.value
            if not past_pickup and status == "in_mission":
                mission.pickup_waypoint_index = p_idx
            elif not past_pickup and status == "going_to_charging":


                mission.pickup_waypoint_index = 9999


            if active_del:
                drone.dest_latitude = float(active_del.dest_lat)
                drone.dest_longitude = float(active_del.dest_lon)
        
        db.commit()
        _broadcast_drone_update(drone, mission)
        

        if mission:
            try:
                if status == "going_to_charging":
                    mission_event_service.log_event(db, mission.id, "CHARGE_DETOUR", "Detouring to station before goal")
                else:
                    mission_event_service.log_event(db, mission.id, "RESUME", f"Resumed mission toward {resume_mission_status.value}")
                db.commit()
            except Exception:
                db.rollback()
        return True
    else:
        db.commit()
    

    mission = mission_service.get_active_mission_for_drone(db, drone.id)
    _broadcast_drone_update(drone, mission)
    
    return True


def _fail_mission(db, drone: Drone, reason: str):
    """
    Handle mission failure: try to reassign the delivery to another drone first.
    Only mark as FAILED if no other drone is available.
    """
    delivery = db.query(Delivery).filter(
        Delivery.drone_id == drone.id,
        Delivery.status.in_(list(ACTIVE_DELIVERY_STATUSES))
    ).first()


    mission = mission_service.get_active_mission_for_drone(db, drone.id)
    if mission:
        mission_event_service.log_event(db, mission.id, "STUCK", reason)


    failed_drone_id = drone.id
    is_motor_failure = "motor failure" in reason.lower()
    drone.status = "maintenance" if is_motor_failure else "idle"
    drone.maintenance_source = "simulator" if is_motor_failure else None
    drone.battery = 100.0 if not is_motor_failure else drone.battery
    drone.route_path = None
    drone.route_index = 0
    drone.dest_latitude = None
    drone.dest_longitude = None
    drone.stuck_steps = 0
    drone.charge_count = 0
    db.commit()

    if delivery:

        mission_service.fail_mission(db, delivery.id, reason)
        mission = db.query(Mission).filter(
            Mission.delivery_id == delivery.id,
            Mission.status == MissionStatus.FAILED.value,
        ).first()
        if mission:
            mission_event_service.log_event(db, mission.id, "FAILED", reason)
            alert_service.alert_mission_aborted(db, mission.id, drone, reason)

        db.commit()
        _broadcast_drone_update(drone, None)


        if delivery.status in ("picked_up", "in_transit"):
            delivery.pickup_lat = drone.latitude
            delivery.pickup_lon = drone.longitude
            delivery.notes += f" [Relocated from crash site: {drone.latitude:.4f}, {drone.longitude:.4f}]"


        delivery.status = "pending"

        delivery.drone_id = None
        

        import re
        if delivery.notes and "fail_timer=" in delivery.notes and "(resolved)" not in delivery.notes:
            delivery.notes = re.sub(r'(fail_timer=[\d\.]+)', r'\1 (resolved)', delivery.notes)
            
        db.commit()


        from backend.services.delivery_service import reassign_delivery
        reassigned = reassign_delivery(
            db,
            delivery.id,
            exclude_drone_id=failed_drone_id,
            reason=f"Auto-reassign: {reason} (drone #{failed_drone_id})",
        )

        if reassigned:
            db.refresh(delivery)
            alert_service.alert_auto_reassign(db, delivery.id, drone.name, reason)
            print(f"[Simulator] Delivery #{delivery.id} REASSIGNED from drone #{failed_drone_id} "
                  f"to drone #{delivery.drone_id} (reason: {reason})")
            _broadcast_delivery_update(db, delivery.id)
        else:
            alert_service.alert_delivery_failed(db, delivery.id, reason)
            print(f"[Simulator] Delivery #{delivery.id} FAILED — no drone available for reassignment "
                  f"(reason: {reason})")
            _broadcast_delivery_update(db, delivery.id)
    else:
        db.commit()
        _broadcast_drone_update(drone, None)


ASSIGN_SCAN_INTERVAL = 10


ORPHAN_SCAN_INTERVAL = 15


def _recover_orphaned_deliveries(db):
    """
    Detect deliveries that are stuck in an active status but whose assigned drone
    is no longer processing them (drone is idle with no route_path). This can happen
    when a mission fails mid-flight and the delivery status is not properly reset.
    Resets such deliveries to PENDING so they can be reassigned.
    """
    from backend.services.delivery_service import log_delivery_event

    orphaned = db.query(Delivery).filter(
        Delivery.status.in_(list(ACTIVE_DELIVERY_STATUSES)),
        Delivery.drone_id != None,
    ).all()

    for delivery in orphaned:
        drone = db.query(Drone).filter(Drone.id == delivery.drone_id).first()
        if drone is None:

            delivery.status = "pending"
            delivery.drone_id = None
            log_delivery_event(db, delivery, "REASSIGN_PENDING", "Orphan recovery: assigned drone missing")
            db.commit()
            print(f"[Simulator] Orphan recovery: delivery #{delivery.id} drone deleted — reset to pending")
            continue


        if drone.status == "idle" and not drone.route_path:
            delivery.status = "pending"
            delivery.drone_id = None
            drone.dest_latitude = None
            drone.dest_longitude = None
            log_delivery_event(db, delivery, "REASSIGN_PENDING", f"Orphan recovery: drone #{drone.id} is idle with no route")
            db.commit()
            print(f"[Simulator] Orphan recovery: delivery #{delivery.id} assigned to idle drone #{drone.id} — reset to pending")


def _auto_assign_pending(db):
    """
    Scan for pending deliveries and try to auto-assign idle drones.
    Only emergency and high priority deliveries are auto-assigned by the background
    thread — normal, urgent, and low priority deliveries are left for the dispatcher
    to manually review and approve via the dashboard.
    Sorted by priority (emergency first) so critical packages get served immediately.
    """
    from backend.services.delivery_service import auto_assign_delivery, PRIORITY_ORDER


    AUTO_ASSIGN_PRIORITIES = {"emergency", "high"}

    pending = db.query(Delivery).filter(
        Delivery.status.in_(["pending", "created"]),
        Delivery.priority.in_(list(AUTO_ASSIGN_PRIORITIES)),
    ).all()

    if not pending:
        return


    pending.sort(
        key=lambda d: (-PRIORITY_ORDER.get(d.priority or "normal", 1),
                       d.created_at or datetime.min)
    )

    assigned_count = 0
    for delivery in pending:
        try:
            if auto_assign_delivery(db, delivery, quiet=True):
                assigned_count += 1
                print(f"[AutoAssign] Delivery #{delivery.id} ({delivery.priority}) → Drone #{delivery.drone_id}")
        except Exception as e:
            logger.debug("Auto-assign failed for delivery #%s: %s", delivery.id, e)

    if assigned_count:
        print(f"[AutoAssign] Assigned {assigned_count}/{len(pending)} pending deliveries.")


def _simulator_loop():
    tick_count = 0
    next_tick = time.time()
    while True:
        pause_event.wait()
        next_tick += STEP_INTERVAL_SEC
        
        db = None
        try:
            db = SessionLocal()
            tick_count += 1


            for drone in db.query(Drone).all():
                try:
                    if drone.status in ("in_mission", "going_to_charging"):
                        _step_drone(db, drone)
                    elif drone.status == "charging":
                        _charge_drone(db, drone)
                    elif drone.status == "idle":

                        if drone.battery > 0:
                            drone.battery = round(max(0, drone.battery - 0.005), 2)
                            if tick_count % 30 == 0:
                                db.commit()
                                _broadcast_drone_update(drone, None)
                    elif drone.status == "maintenance":


                        if getattr(drone, "maintenance_source", None) == "manual":
                            if tick_count % 30 == 0:
                                db.commit()
                                _broadcast_drone_update(drone, None)
                            continue


                        drone.stuck_steps = (drone.stuck_steps or 0) + 1
                        if drone.stuck_steps >= 120:

                            drone.status = "idle"
                            drone.maintenance_source = None
                            drone.stuck_steps = 0
                            drone.charge_count = 0
                            drone.route_path = None
                            drone.route_index = 0
                            drone.dest_latitude = None
                            drone.dest_longitude = None

                            drone.battery = 100.0
                            db.commit()
                            _broadcast_drone_update(drone, None)
                        else:

                            db.commit()


                            if drone.stuck_steps % 30 == 0:
                                _broadcast_drone_update(drone, None)
                except Exception as de:
                    logger.error(f"Error stepping drone {drone.id}: {de}", exc_info=True)
                    try:
                        db.rollback()
                    except Exception:
                        pass


            if tick_count % ASSIGN_SCAN_INTERVAL == 0:
                def run_auto_assign():
                    db_slow = None
                    try:
                        from backend.services.delivery_service import _assignment_lock

                        if not _assignment_lock.acquire(blocking=False):
                            return
                        _assignment_lock.release()
                        db_slow = SessionLocal()
                        _auto_assign_pending(db_slow)
                    except Exception as e:
                        logger.error("auto-assign scan error: %s", e)
                    finally:
                        if db_slow:
                            db_slow.close()
                threading.Thread(target=run_auto_assign, daemon=True).start()

            if tick_count % ORPHAN_SCAN_INTERVAL == 0:
                def run_orphan_scan():
                    db_slow = None
                    try:
                        db_slow = SessionLocal()
                        _recover_orphaned_deliveries(db_slow)
                    except Exception as e:
                        logger.error("orphan scan error: %s", e)
                    finally:
                        if db_slow:
                            db_slow.close()
                threading.Thread(target=run_orphan_scan, daemon=True).start()

        except Exception as e:
            print(f"[Simulator] Error: {e}")
            logger.error("Simulator loop error: %s", e)
        finally:
            if db:
                db.close()

        sleep_time = next_tick - time.time()
        if sleep_time > 0:
            time.sleep(sleep_time)
        else:
            time.sleep(0.01)
            next_tick = time.time()


simulator_thread = None
pause_event = threading.Event()
pause_event.set()


def start_simulator():
    global simulator_thread
    if simulator_thread is None:
        simulator_thread = threading.Thread(target=_simulator_loop, daemon=True)
        simulator_thread.start()
        print("[Simulator] Background thread started.")


def pause_simulator():
    """Simulator cannot be fully stopped once thread starts, but we can pause it."""
    pause_event.clear()
    print("[Simulator] Paused.")


def resume_simulator():
    pause_event.set()
    print("[Simulator] Resumed.")


def is_simulator_running():
    """Checks if the simulator thread is alive and not paused."""
    return simulator_thread is not None and simulator_thread.is_alive() and pause_event.is_set()
