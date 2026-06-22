"""
Services for managing deliveries: auto-assign, mark delivered, etc.
Priority system: emergency > high > urgent > normal > low.
Emergency/medical: selects the drone with the highest battery.
"""
import random
import threading
from collections import Counter
from typing import Optional
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from backend.models.drone import Drone
from backend.models.delivery import Delivery
from backend.models.mission import Mission
from backend.models.mission_event import MissionEvent
from backend.models.user import User
from backend.services.grid import city_grid, haversine_distance
from backend.app.core.delivery_state import DeliveryStatus, can_transition, get_delivery_status, ACTIVE_DELIVERY_STATUSES, ACTIVE_MISSION_STATUSES
from backend.services import mission_service
from backend.services import mission_event_service
from backend.services.no_fly_zone_service import get_blocked_cells
from backend.services.battery_service import estimate_range_km, compute_effective_speed
from backend.services.charging_stations import find_station_chain, MAX_AUTONOMY_KM, CHARGING_STATIONS
from backend.services.email_service import send_delivery_confirmation_code
from backend.services.weather_service import get_weather_impact_at
from backend.routes.ws import manager
from backend.services.routing_utils import plan_route_leg as _plan_route_leg_raw


_route_leg_cache: dict = {}

def _clear_route_cache() -> None:
    """Clear the per-ranking-call route cache."""
    global _route_leg_cache
    _route_leg_cache = {}

def plan_route_leg(start_lat, start_lon, end_lat, end_lon, blocked_cells):
    """Cached wrapper: avoids re-running A* for the same pair in one ranking pass."""
    key = (round(float(start_lat), 4), round(float(start_lon), 4),
           round(float(end_lat), 4), round(float(end_lon), 4))
    if key not in _route_leg_cache:
        _route_leg_cache[key] = _plan_route_leg_raw(start_lat, start_lon, end_lat, end_lon, blocked_cells)
    return _route_leg_cache[key]

MIN_BATTERY_FOR_DELIVERY = 10


PRIORITY_ORDER = {"low": 0, "normal": 1, "urgent": 2, "high": 3, "emergency": 4}


_ASSIGNABLE_DELIVERY_STATUSES = frozenset(
    {DeliveryStatus.PENDING.value, DeliveryStatus.CREATED.value}
)


_assignment_lock = threading.Lock()


def get_delivery_by_id(db: Session, delivery_id: int) -> Optional[Delivery]:
    """Returns a delivery by its ID."""
    return db.query(Delivery).filter(Delivery.id == delivery_id).first()


def get_all_deliveries(db: Session, skip: int = 0, limit: int = 100) -> list[Delivery]:
    """Returns a list of all deliveries with pagination."""
    return db.query(Delivery).offset(skip).limit(limit).all()


def update_delivery_status(db: Session, delivery_id: int, new_status: str) -> Optional[Delivery]:
    """
    Updates the status of a delivery.
    Performs basic validation of status transitions.
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        return None
    
    current = get_delivery_status(delivery.status)
    try:
        requested = DeliveryStatus(new_status)
    except ValueError:
        raise ValueError(f"Invalid status: {new_status}")

    if not can_transition(current, requested):
        raise ValueError(f"Cannot transition from {delivery.status} to {new_status}")

    if requested == DeliveryStatus.DELIVERED:
        if not mark_delivery_as_delivered(db, delivery_id):
            return None
        return get_delivery_by_id(db, delivery_id)

    delivery.status = new_status
    if new_status in ("delivered", "failed", "cancelled"):
        delivery.completed_at = datetime.now(timezone.utc)
    
    db.commit()
    db.refresh(delivery)
    return delivery


def _mission_weight_kg(drone, delivery: Delivery) -> float:
    """Effective weight drone + package (capped at 25 kg)."""
    base = float(getattr(drone, "weight_kg", None) or 3.5)
    extra = float(getattr(delivery, "weight_kg", None) or 0.0)
    return max(0.1, base + extra)


def _score_drone_for_delivery(drone, delivery: Delivery, blocked, dist_to_pickup: float) -> tuple | None:
    """
    Advanced scoring considering: distance, battery, health, charging stops, and mission plan.
    Returns (score, planned_data). Smaller score = better.
    dist_to_pickup must be pre-calculated by the caller (avoids redundant haversine calls).
    """
    planned_data, rejection_reason = _plan_combined_grid_route(drone, delivery, blocked)
    if planned_data is None:
        return None, rejection_reason

    combined_route, route_total_km, pickup_waypoint_index, charging_stops, weather_penalty = planned_data

    batt = float(drone.battery or 0)
    health = float(getattr(drone, "battery_health", 100.0) or 100.0)
    w = _mission_weight_kg(drone, delivery)
    est_range = estimate_range_km(
        battery_pct=batt,
        max_battery_wh=float(getattr(drone, "max_battery_wh", 500.0) or 500.0),
        battery_health=health,
        weight_kg=w,
        motor_efficiency=float(getattr(drone, "motor_efficiency", 0.92) or 0.92),
    )

    priority = (getattr(delivery, "priority", "normal") or "normal").lower()
    p_mult = {"emergency": 0.5, "urgent": 0.85, "normal": 1.0}.get(priority, 1.0)

    if priority == "emergency":
        range_margin = max(0, est_range - route_total_km)
        margin_penalty = max(0, 30.0 - range_margin) * 0.8
        score = (
            dist_to_pickup * 0.6
            + route_total_km * 0.10
            + charging_stops * 60.0
            + (100.0 - batt) * 1.5
            + (100.0 - health) * 0.5
            + weather_penalty * 2.0
            + margin_penalty
        )
    else:
        range_margin = max(0, est_range - route_total_km)
        low_battery_penalty = max(0.0, 40.0 - batt) * 2.5
        battery_health_penalty = max(0.0, 85.0 - health) * 0.5
        margin_penalty = max(0.0, 25.0 - range_margin) * 0.5

        if charging_stops == 0:
            reliability_penalty = max(0.0, route_total_km * 1.15 - est_range) * 1.0
        else:
            reliability_penalty = max(0.0, 40.0 - batt) * 1.0

        score = (
            dist_to_pickup * 2.50
            + route_total_km * 0.10
            + charging_stops * 25.0
            + weather_penalty * 1.5
            + low_battery_penalty
            + battery_health_penalty
            + margin_penalty
            + reliability_penalty
        )

    final_score = round(score * p_mult, 2)

    return final_score, planned_data


def _check_drone_basic_eligibility(db: Session, drone: Drone) -> str | None:
    """
    Returns None if drone is eligible for assignment, or a reason string if not.
    Checks status, coordinates, battery, active missions, and active deliveries.
    """
    if drone.status != "idle":
        return f"not idle: {drone.status}"

    if drone.latitude is None or drone.longitude is None:
        return "missing coordinates"

    batt = float(drone.battery or 0)
    if batt < MIN_BATTERY_FOR_DELIVERY:
        return f"battery too low: {batt}%"

    has_active_mission = db.query(Mission).filter(
        Mission.drone_id == drone.id,
        Mission.status.in_(list(ACTIVE_MISSION_STATUSES)),
        Mission.end_time == None,
    ).first() is not None

    if has_active_mission:
        return "has active mission"

    has_active_delivery = db.query(Delivery).filter(
        Delivery.drone_id == drone.id,
        Delivery.status.in_(list(ACTIVE_DELIVERY_STATUSES)),
    ).first() is not None

    if has_active_delivery:
        return "has active delivery"

    return None


def rank_drones_for_delivery(db: Session, delivery: Delivery, exclude_drone_ids: set | None = None, quiet: bool = False) -> list[dict]:
    """
    Ranks all available drones for a delivery using advanced scoring.
    Sorts candidates by proximity to pickup first, then checks feasibility and scores.
    Returns a sorted list of dicts: [{"drone": Drone, "score": float, ...}]
    """
    _clear_route_cache()
    blocked = get_blocked_cells(city_grid)

    drones = db.query(Drone).filter(
        Drone.latitude != None,
        Drone.longitude != None,
    ).all()


    candidates = []
    for drone in drones:
        if exclude_drone_ids and drone.id in exclude_drone_ids:
            continue
        dist_to_pickup = haversine_distance(
            float(drone.latitude),
            float(drone.longitude),
            float(delivery.pickup_lat),
            float(delivery.pickup_lon),
        )
        candidates.append((drone, dist_to_pickup))

    candidates.sort(key=lambda x: x[1])

    if not quiet:
        print(f"=== DRONE RANKING FOR DELIVERY {delivery.id} ===")

    results = []

    for drone, dist_to_pickup in candidates:
        reason = _check_drone_basic_eligibility(db, drone)
        if reason is not None:
            if not quiet:
                print(f"SKIPPED {drone.name}: {reason}")
            continue

        scored = _score_drone_for_delivery(
            drone=drone,
            delivery=delivery,
            blocked=blocked,
            dist_to_pickup=dist_to_pickup,
        )

        if scored is None or scored[0] is None:
            reason = scored[1] if scored is not None else "unknown"
            if not quiet:
                print(f"REJECTED {drone.name}: {reason}")
            continue

        score, planned_data = scored
        route_path, route_total_km, pickup_index, charging_stops, weather_penalty = planned_data

        results.append({
            "drone": drone,
            "score": score,
            "planned": planned_data,
            "dist_to_pickup_km": round(dist_to_pickup, 2),
            "route_total_km": round(route_total_km, 2),
            "charging_stops": charging_stops,
            "weather_penalty": weather_penalty,
        })

    results.sort(key=lambda x: (x["score"], x["dist_to_pickup_km"]))

    if not quiet:
        print("=== FINAL DRONE RANKING ===")
        for i, item in enumerate(results[:10], start=1):
            d = item["drone"]
            print(
                f"{i}. {d.name} | score={item['score']:.2f} | "
                f"to_pickup={item['dist_to_pickup_km']} km | "
                f"total={item['route_total_km']} km | "
                f"stops={item['charging_stops']} | "
                f"battery={d.battery}% | "
                f"pos=({d.latitude}, {d.longitude})"
            )

        if results:
            best = results[0]
            print(f"=== SELECTED DRONE: {best['drone'].name} (ID: {best['drone'].id}) | Score: {best['score']} ===")
        else:
            print("=== NO CAPABLE DRONES FOUND (UNIFIED RANKING) ===")

    return results


def _route_polyline_distance_km(points: list) -> float:
    total = 0.0
    for i in range(len(points) - 1):
        p1, p2 = points[i], points[i + 1]
        total += haversine_distance(p1[0], p1[1], p2[0], p2[1])
    return total


def _append_leg_no_duplicate(path: list, leg: list) -> None:
    """Append a route leg to path, skipping the first point if it duplicates the last."""
    if not leg:
        return
    if not path:
        path.extend(leg)
    else:
        path.extend(leg[1:])


def _try_pre_pickup_topup(
    drone,
    delivery: Delivery,
    blocked,
    current_range: float,
    max_range: float,
):
    """
    Tries to route through a charging station before pickup, even if pickup is directly
    reachable. This lets nearby drones top up so they can continue to the destination.

    Returns a dict with {path_to_pickup, charging_stops_before_pickup,
    remaining_after_pickup, distance_to_pickup} on success, or None.
    """
    best_candidate = None

    for station in CHARGING_STATIONS:
        station_lat, station_lon, _station_name = station


        h_station_to_pickup = haversine_distance(station_lat, station_lon, delivery.pickup_lat, delivery.pickup_lon)
        if h_station_to_pickup > max_range + 0.1:
            continue


        station_to_pickup = plan_route_leg(
            station_lat, station_lon,
            delivery.pickup_lat, delivery.pickup_lon,
            blocked,
        )
        if not station_to_pickup or len(station_to_pickup) < 2:
            continue
        station_to_pickup_km = _route_polyline_distance_km(station_to_pickup)
        if station_to_pickup_km > max_range + 0.05:
            continue


        chain_to_station = find_station_chain(
            float(drone.latitude), float(drone.longitude),
            station_lat, station_lon,
            first_leg_km=current_range,
            full_leg_km=max_range,
        )
        if chain_to_station is None:
            continue


        stops = list(chain_to_station)
        if not stops or haversine_distance(stops[-1][0], stops[-1][1], station_lat, station_lon) > 0.1:
            stops.append(station)


        full_path_to_pickup: list = []
        curr_lat = float(drone.latitude)
        curr_lon = float(drone.longitude)
        total_to_pickup = 0.0
        valid = True

        for i, stop in enumerate(stops):
            stop_lat, stop_lon = stop[0], stop[1]
            leg = plan_route_leg(curr_lat, curr_lon, stop_lat, stop_lon, blocked)
            if not leg or len(leg) < 2:
                valid = False
                break
            leg_km = _route_polyline_distance_km(leg)
            allowed_range = current_range if i == 0 else max_range
            if leg_km > allowed_range + 0.05:
                valid = False
                break
            _append_leg_no_duplicate(full_path_to_pickup, leg)
            total_to_pickup += leg_km
            curr_lat, curr_lon = stop_lat, stop_lon

        if not valid:
            continue


        leg_to_pickup = plan_route_leg(
            curr_lat, curr_lon,
            delivery.pickup_lat, delivery.pickup_lon,
            blocked,
        )
        if not leg_to_pickup or len(leg_to_pickup) < 2:
            continue
        leg_to_pickup_km = _route_polyline_distance_km(leg_to_pickup)
        if leg_to_pickup_km > max_range + 0.05:
            continue

        _append_leg_no_duplicate(full_path_to_pickup, leg_to_pickup)
        total_to_pickup += leg_to_pickup_km


        remaining_after_pickup = max(0.0, max_range - leg_to_pickup_km)


        chain_pickup_dest = find_station_chain(
            delivery.pickup_lat, delivery.pickup_lon,
            delivery.dest_lat, delivery.dest_lon,
            first_leg_km=remaining_after_pickup,
            full_leg_km=max_range,
        )
        if chain_pickup_dest is None:
            continue

        candidate = {
            "path_to_pickup": full_path_to_pickup,
            "charging_stops_before_pickup": len(stops),
            "remaining_after_pickup": remaining_after_pickup,
            "distance_to_pickup": total_to_pickup,
        }

        if best_candidate is None:
            best_candidate = candidate
        else:
            current_cost = total_to_pickup + len(stops) * 50
            best_cost = (best_candidate["distance_to_pickup"]
                         + best_candidate["charging_stops_before_pickup"] * 50)
            if current_cost < best_cost:
                best_candidate = candidate

    return best_candidate


def _plan_combined_grid_route(
    drone,
    delivery: Delivery,
    blocked,
) -> tuple | None:
    """
    Returns ((combined_route, route_total_km, pickup_waypoint_index, charging_stops, weather_penalty), None) if valid.
    Otherwise returns (None, reason_string).
    """

    empty_w = max(0.1, float(getattr(drone, "weight_kg", None) or 3.5))
    w = _mission_weight_kg(drone, delivery)
    current_range = estimate_range_km(
        battery_pct=float(drone.battery or 0),
        max_battery_wh=float(getattr(drone, "max_battery_wh", None) or 500.0),
        battery_health=float(getattr(drone, "battery_health", None) or 100.0),
        weight_kg=empty_w,
        motor_efficiency=float(getattr(drone, "motor_efficiency", None) or 0.92),
    )
    max_range_empty = estimate_range_km(
        battery_pct=100.0,
        max_battery_wh=float(getattr(drone, "max_battery_wh", None) or 500.0),
        battery_health=float(getattr(drone, "battery_health", None) or 100.0),
        weight_kg=empty_w,
        motor_efficiency=float(getattr(drone, "motor_efficiency", None) or 0.92),
    )
    max_range = estimate_range_km(
        battery_pct=100.0,
        max_battery_wh=float(getattr(drone, "max_battery_wh", None) or 500.0),
        battery_health=float(getattr(drone, "battery_health", None) or 100.0),
        weight_kg=w,
        motor_efficiency=float(getattr(drone, "motor_efficiency", None) or 0.92),
    )


    route_to_pickup = plan_route_leg(
        drone.latitude, drone.longitude,
        delivery.pickup_lat, delivery.pickup_lon,
        blocked,
    )


    if not route_to_pickup or len(route_to_pickup) < 2:
        route_to_pickup = [
            [float(drone.latitude), float(drone.longitude)],
            [float(delivery.pickup_lat), float(delivery.pickup_lon)],
        ]
        
    dist_to_pickup = _route_polyline_distance_km(route_to_pickup)
    last_leg_to_pickup_km = None
    charging_stops = 0
    final_path_to_pickup = route_to_pickup

    if dist_to_pickup <= current_range + 0.05:
        last_leg_to_pickup_km = dist_to_pickup

    if dist_to_pickup > current_range + 0.05:
        chain = find_station_chain(
            float(drone.latitude), float(drone.longitude),
            delivery.pickup_lat, delivery.pickup_lon,
            first_leg_km=current_range,
            full_leg_km=max_range_empty
        )


        if chain is None:
            return None, "no station chain to pickup (range issues)"
        
        if len(chain) == 0:


            GRID_TOLERANCE_PICKUP = current_range * 0.15
            if dist_to_pickup > current_range + GRID_TOLERANCE_PICKUP:

                return None, "pickup out of range (grid distance exceeds haversine estimate)"

        elif len(chain) > 0:

            charging_stops += len(chain)
            full_p_path = []
            curr_lat, curr_lon = float(drone.latitude), float(drone.longitude)
            for i, s in enumerate(chain):
                leg = plan_route_leg(curr_lat, curr_lon, s[0], s[1], blocked)
                if not leg: return None, "path to pickup station blocked by NFZ"
                

                leg_dist = _route_polyline_distance_km(leg)
                limit = current_range if i == 0 else max_range_empty
                if leg_dist > limit + 0.05:
                    return None, "station out of range during pickup leg"
                    
                full_p_path.extend(leg[:-1])
                curr_lat, curr_lon = s[0], s[1]
            
            leg_to_pickup = plan_route_leg(curr_lat, curr_lon, delivery.pickup_lat, delivery.pickup_lon, blocked)
            if not leg_to_pickup: return None, "last leg to pickup blocked by NFZ"
            

            last_leg_to_pickup_km = _route_polyline_distance_km(leg_to_pickup)
            if last_leg_to_pickup_km > max_range_empty + 0.05:
                return None, "pickup location out of range from last station"
                
            full_p_path.extend(leg_to_pickup)
            final_path_to_pickup = full_p_path


    dist_to_pickup_real = _route_polyline_distance_km(final_path_to_pickup)
    

    if charging_stops > 0:
        remaining_after_pickup_empty = max(0.0, max_range_empty - float(last_leg_to_pickup_km or 0.0))
    else:
        remaining_after_pickup_empty = max(0.0, current_range - dist_to_pickup_real)


    remaining_range_after_pickup = (remaining_after_pickup_empty / max_range_empty) * max_range


    strategic_topup = _try_pre_pickup_topup(
        drone,
        delivery,
        blocked,
        current_range=current_range,
        max_range=max_range_empty,
    )

    if strategic_topup is not None:


        scaled_strategic_remaining = (strategic_topup["remaining_after_pickup"] / max_range_empty) * max_range
        if scaled_strategic_remaining > remaining_range_after_pickup + 20.0:
            if strategic_topup["distance_to_pickup"] <= dist_to_pickup_real + 80.0:
                final_path_to_pickup = strategic_topup["path_to_pickup"]
                charging_stops += strategic_topup["charging_stops_before_pickup"]
                remaining_range_after_pickup = scaled_strategic_remaining
                dist_to_pickup_real = _route_polyline_distance_km(final_path_to_pickup)


    route_pickup_dest = plan_route_leg(
        delivery.pickup_lat, delivery.pickup_lon,
        delivery.dest_lat, delivery.dest_lon,
        blocked,
    )
    if not route_pickup_dest or len(route_pickup_dest) < 2:
        return None, "direct path to destination blocked by NFZ"
        
    dist_pickup_dest = _route_polyline_distance_km(route_pickup_dest)
    final_path_pickup_dest = route_pickup_dest


    if dist_pickup_dest > remaining_range_after_pickup + 0.05:
        chain = find_station_chain(
            delivery.pickup_lat, delivery.pickup_lon,
            delivery.dest_lat, delivery.dest_lon,
            first_leg_km=remaining_range_after_pickup,
            full_leg_km=max_range
        )

        if chain is None:


            pre_pickup_plan = _try_pre_pickup_topup(
                drone, delivery, blocked,
                current_range=current_range,
                max_range=max_range_empty,
            )
            if pre_pickup_plan is None:
                return None, "no station chain to destination even with pre-pickup charging"

            final_path_to_pickup = pre_pickup_plan["path_to_pickup"]
            charging_stops += pre_pickup_plan["charging_stops_before_pickup"]
            remaining_range_after_pickup = (pre_pickup_plan["remaining_after_pickup"] / max_range_empty) * max_range


            chain = find_station_chain(
                delivery.pickup_lat, delivery.pickup_lon,
                delivery.dest_lat, delivery.dest_lon,
                first_leg_km=remaining_range_after_pickup,
                full_leg_km=max_range,
            )
            if chain is None:
                return None, "destination still unreachable after pre-pickup charging"
        elif len(chain) == 0:


            GRID_TOLERANCE = max_range * 0.15
            if dist_pickup_dest <= remaining_range_after_pickup + GRID_TOLERANCE:

                pass
            else:

                pre_pickup_plan = _try_pre_pickup_topup(
                    drone, delivery, blocked,
                    current_range=current_range,
                    max_range=max_range_empty,
                )
                if pre_pickup_plan is None:
                    return None, "destination unreachable (haversine mismatch, no top-up fixes it)"

                final_path_to_pickup = pre_pickup_plan["path_to_pickup"]
                charging_stops += pre_pickup_plan["charging_stops_before_pickup"]
                remaining_range_after_pickup = (pre_pickup_plan["remaining_after_pickup"] / max_range_empty) * max_range

                chain = find_station_chain(
                    delivery.pickup_lat, delivery.pickup_lon,
                    delivery.dest_lat, delivery.dest_lon,
                    first_leg_km=remaining_range_after_pickup,
                    full_leg_km=max_range,
                )
                if not chain:
                    return None, "destination unreachable even with top-up"

        if isinstance(chain, list) and len(chain) > 0:


            charging_stops += len(chain)
            full_d_path = []
            curr_lat, curr_lon = delivery.pickup_lat, delivery.pickup_lon
            for i, s in enumerate(chain):
                leg = plan_route_leg(curr_lat, curr_lon, s[0], s[1], blocked)
                if not leg: return None, "path to delivery station blocked by NFZ"
                

                leg_dist = _route_polyline_distance_km(leg)
                leg_limit = remaining_range_after_pickup if i == 0 else max_range
                if leg_dist > leg_limit + 0.05:
                    return None, "station out of range during delivery leg"
                    
                full_d_path.extend(leg[:-1])
                curr_lat, curr_lon = s[0], s[1]
                
            leg_to_dest = plan_route_leg(curr_lat, curr_lon, delivery.dest_lat, delivery.dest_lon, blocked)
            if not leg_to_dest: return None, "final leg to destination blocked by NFZ"
            

            if _route_polyline_distance_km(leg_to_dest) > max_range + 0.05:
                return None, "destination out of range from last station"
                
            full_d_path.extend(leg_to_dest)
            final_path_pickup_dest = full_d_path


    raw_full_path = final_path_to_pickup[:-1] + final_path_pickup_dest


    pickup_coords = (
        float(final_path_to_pickup[-1][0]),
        float(final_path_to_pickup[-1][1]),
    )


    actual_full_path = []
    pickup_waypoint_index = 0

    for pt in raw_full_path:
        if not actual_full_path or (pt[0] != actual_full_path[-1][0] or pt[1] != actual_full_path[-1][1]):
            actual_full_path.append(pt)


        last = actual_full_path[-1]
        if abs(float(last[0]) - pickup_coords[0]) < 1e-7 and abs(float(last[1]) - pickup_coords[1]) < 1e-7:
            pickup_waypoint_index = len(actual_full_path) - 1


    if len(actual_full_path) < 2:
        actual_full_path.append(actual_full_path[-1])


    pickup_waypoint_index = min(pickup_waypoint_index, len(actual_full_path) - 2)

    
    from backend.services.weather_service import check_weather_safety_on_route
    weather_check = check_weather_safety_on_route(actual_full_path)
    

    if not weather_check["safe"]:
        return None, f"unsafe weather: {weather_check.get('reason', 'general warning')}"


    weather_penalty = weather_check.get("weather_penalty", 0.0)


    real_total_km = _route_polyline_distance_km(actual_full_path)

    return (actual_full_path, real_total_km, pickup_waypoint_index, charging_stops, round(weather_penalty, 2)), None


def debug_rank_drones_for_delivery(db: Session, delivery: Delivery) -> dict:
    """
    Returns a full debug view of drone ranking for a delivery.

    For every drone in the fleet (with coordinates), reports:
      - eligibility (status, battery, active mission/delivery)
      - if eligible: score, route info, or rejection reason if route fails
    Sorted: eligible+scored first (by score ascending), then ineligible.
    """
    _clear_route_cache()
    blocked = get_blocked_cells(city_grid)

    drones = db.query(Drone).filter(
        Drone.latitude != None,
        Drone.longitude != None,
    ).all()

    entries = []

    for drone in drones:
        dist_to_pickup = haversine_distance(
            float(drone.latitude), float(drone.longitude),
            float(delivery.pickup_lat), float(delivery.pickup_lon),
        )

        ineligible_reason = _check_drone_basic_eligibility(db, drone)
        if ineligible_reason is not None:
            entries.append({
                "name": drone.name,
                "drone_id": drone.id,
                "status": drone.status,
                "battery": drone.battery,
                "battery_health": getattr(drone, "battery_health", 100.0),
                "dist_to_pickup_km": round(dist_to_pickup, 2),
                "eligible": False,
                "scored": False,
                "score": None,
                "charging_stops": None,
                "route_total_km": None,
                "weather_penalty": None,
                "reason": ineligible_reason,
            })
            continue

        scored = _score_drone_for_delivery(
            drone=drone,
            delivery=delivery,
            blocked=blocked,
            dist_to_pickup=dist_to_pickup,
        )

        if scored is None or scored[0] is None:
            rejection = scored[1] if scored is not None else "unknown"
            entries.append({
                "name": drone.name,
                "drone_id": drone.id,
                "status": drone.status,
                "battery": drone.battery,
                "battery_health": getattr(drone, "battery_health", 100.0),
                "dist_to_pickup_km": round(dist_to_pickup, 2),
                "eligible": True,
                "scored": False,
                "score": None,
                "charging_stops": None,
                "route_total_km": None,
                "weather_penalty": None,
                "reason": rejection,
            })
            continue

        score, planned_data = scored
        _, route_total_km, _, charging_stops, weather_penalty = planned_data
        entries.append({
            "name": drone.name,
            "drone_id": drone.id,
            "status": drone.status,
            "battery": drone.battery,
            "battery_health": getattr(drone, "battery_health", 100.0),
            "dist_to_pickup_km": round(dist_to_pickup, 2),
            "eligible": True,
            "scored": True,
            "score": round(score, 2),
            "charging_stops": charging_stops,
            "route_total_km": round(route_total_km, 2),
            "weather_penalty": round(weather_penalty, 2),
            "reason": "eligible",
        })


    def _sort_key(e):
        if e["scored"]:
            return (0, e["score"])
        if e["eligible"]:
            return (1, e["dist_to_pickup_km"])
        return (2, e["dist_to_pickup_km"])

    entries.sort(key=_sort_key)

    best = next((e for e in entries if e["scored"]), None)
    best_summary = (
        {"name": best["name"], "score": best["score"], "dist_to_pickup_km": best["dist_to_pickup_km"]}
        if best else None
    )

    return {"best": best_summary, "drones": entries}


def log_delivery_event(db: Session, delivery: Delivery, event_type: str, message: str = None):
    if not delivery.drone_id:
        return

    mission = mission_service.get_active_mission_for_drone(db, delivery.drone_id)

    if mission:
        mission_event_service.log_event(
            db,
            mission.id,
            event_type,
            message or f"{event_type} for delivery {delivery.id}"
        )


def estimate_delivery(pickup_lat, pickup_lon, dest_lat, dest_lon, weight_kg: float = 3.5):
    """Estimates distance (km) and duration (hours) of a delivery."""
    from backend.services.battery_service import compute_effective_speed
    straight_dist = haversine_distance(pickup_lat, pickup_lon, dest_lat, dest_lon)

    est_dist = straight_dist * 1.10
    speed = compute_effective_speed(weight_kg=weight_kg, weather_speed_mult=1.0)
    if speed <= 0:
        return est_dist, 0.0
    duration = est_dist / speed
    duration += 2.0 / 60.0
    return round(est_dist, 2), round(duration, 4)


def auto_assign_delivery(db: Session, delivery: Delivery, exclude_drone_id: int | None = None, exclude_drone_ids: set | None = None, quiet: bool = False) -> bool:
    with _assignment_lock:
        return _auto_assign_delivery_locked(db, delivery, exclude_drone_id, exclude_drone_ids, quiet)


def _auto_assign_delivery_locked(db: Session, delivery: Delivery, exclude_drone_id: int | None = None, exclude_drone_ids: set | None = None, quiet: bool = False) -> bool:

    db.refresh(delivery)
    if delivery.status not in _ASSIGNABLE_DELIVERY_STATUSES:
        return False


    exclusions = set()
    if exclude_drone_id:
        exclusions.add(exclude_drone_id)
    if exclude_drone_ids:
        exclusions.update(exclude_drone_ids)


    ranked = rank_drones_for_delivery(
        db,
        delivery,
        exclude_drone_ids=exclusions,
        quiet=quiet
    )


    if not ranked:
        if not quiet:
            print("=== NO CAPABLE DRONES FOUND (UNIFIED RANKING) ===")
        return False

    best = ranked[0]
    best_drone = best["drone"]
    best_planned = best["planned"]
    best_score = best["score"]

    if not quiet:
        print(f"=== SELECTED DRONE: {best_drone.name} (ID: {best_drone.id}) | Score: {best_score:.2f} ===")

    if best_drone is None or best_planned is None:
        return False


    combined_route, route_total_km, pickup_waypoint_index, charging_stops, weather_penalty = best_planned

    current = get_delivery_status(delivery.status)
    if not can_transition(current, DeliveryStatus.ASSIGNED):
        return False

    best_drone.route_path = [[p[0], p[1]] for p in combined_route]
    best_drone.planned_route_path = [[p[0], p[1]] for p in combined_route]
    best_drone.route_index = 0

    if not quiet:
        print("=== ROUTE ASSIGNED (AUTO) ===")
        print("Drone:", best_drone.id, best_drone.name)
        print("Route points:", len(best_drone.route_path))
        print("Start:", best_drone.route_path[0])
        print("End:", best_drone.route_path[-1])
        print("Full route:", best_drone.route_path)
    best_drone.dest_latitude = delivery.dest_lat
    best_drone.dest_longitude = delivery.dest_lon
    best_drone.status = "in_mission"
    best_drone.charge_count = 0
    best_drone.stuck_steps = 0

    delivery.drone_id = best_drone.id
    delivery.status = DeliveryStatus.ASSIGNED.value
    if not delivery.confirmation_code:
        delivery.confirmation_code = _generate_confirmation_code()

    log_delivery_event(db, delivery, "DRONE_ASSIGNED")

    try:
        if manager and getattr(manager, "active_connections", None):
            manager.queue_broadcast({
                "type": "delivery_update",
                "delivery_id": int(delivery.id),
                "status": delivery.status,
                "drone_id": int(best_drone.id),
            })
            manager.queue_broadcast({
                "type": "drone_update",
                "drone_id": int(best_drone.id),
                "status": best_drone.status,
                "latitude": best_drone.latitude,
                "longitude": best_drone.longitude,
                "battery": best_drone.battery,
                "route_index": int(best_drone.route_index or 0),
                "route_path": best_drone.route_path if isinstance(best_drone.route_path, list) else None,
                "planned_route_path": best_drone.planned_route_path if isinstance(best_drone.planned_route_path, list) else None,
            })
    except Exception:
        pass

    mission_service.create_mission(
        db,
        drone_id=best_drone.id,
        delivery_id=delivery.id,
        estimated_distance_km=float(delivery.estimated_distance_km or route_total_km or 0.0),
        estimated_duration_h=float(delivery.estimated_duration_h or 0.0),
        total_distance_km=float(route_total_km or delivery.estimated_distance_km or 0.0),
        pickup_waypoint_index=pickup_waypoint_index,
        planned_route_path=[[p[0], p[1]] for p in combined_route]
    )

    db.commit()

    return True


def diagnose_assignment(db: Session, delivery: Delivery) -> dict:
    """Returns diagnostics for why auto-assign might fail."""
    if delivery.status in (DeliveryStatus.FAILED.value, DeliveryStatus.CANCELLED.value):
        return _build_failure_diagnostics(db, delivery)

    drones = db.query(Drone).all()
    idle = [drone for drone in drones if drone.status == "idle"]
    idle_count = len(idle)
    coords_ok = all(v is not None for v in [delivery.pickup_lat, delivery.pickup_lon, delivery.dest_lat, delivery.dest_lon])
    blocked = get_blocked_cells(city_grid) if coords_ok else set()
    rejected_drones = []
    eligible_drones = []
    fleet_analysis = []

    for drone in drones:
        drone_diagnostics = _build_assignment_drone_diagnostics(drone, delivery, blocked)
        rejection = drone_diagnostics["reason"]
        fleet_analysis.append(drone_diagnostics)
        if rejection is None:
            eligible_drones.append(drone_diagnostics)
        else:
            rejected_drones.append(drone_diagnostics)

    primary_reason = _get_primary_assignment_reason(
        delivery=delivery,
        coords_ok=coords_ok,
        drones=drones,
        eligible_drones=eligible_drones,
        rejected_drones=rejected_drones,
    )

    out = {
        "delivery_id": int(delivery.id) if getattr(delivery, "id", None) else None,
        "status": getattr(delivery, "status", None),
        "assignable_status": delivery.status in _ASSIGNABLE_DELIVERY_STATUSES,
        "result": _get_assignment_result(delivery, eligible_drones),
        "primary_reason": primary_reason,
        "delivery_requirements": _build_delivery_requirements(delivery),
        "has_coords": bool(coords_ok),
        "idle_drones": idle_count,
        "eligible_drones": eligible_drones,
        "rejected_drones": rejected_drones,
        "fleet_analysis": fleet_analysis,
        "recommendations": _build_assignment_recommendations(delivery, primary_reason, rejected_drones),
        "sample_idle": [
            {"id": int(d.id), "battery": d.battery, "lat": d.latitude, "lon": d.longitude, "status": d.status}
            for d in idle[:5]
        ],
    }
    if coords_ok and idle:

        out["capable_after_battery_filter"] = len(eligible_drones)
        out["any_drone_grid_and_range_ok"] = len(eligible_drones) > 0
    return out


def _build_failure_diagnostics(db: Session, delivery: Delivery) -> dict:
    mission = db.query(Mission).filter(Mission.delivery_id == delivery.id).order_by(Mission.start_time.desc()).first()
    mission_events = []
    if mission is not None:
        mission_events = (
            db.query(MissionEvent)
            .filter(MissionEvent.mission_id == mission.id)
            .order_by(MissionEvent.timestamp.asc())
            .all()
        )

    latest_failure_event = next(
        (
            event for event in reversed(mission_events)
            if event.event_type in {"DELIVERY_FAILED", "DELIVERY_CANCELLED", "MISSION_FAILED", "MISSION_ABORTED", "WEATHER_HOLD"}
        ),
        None,
    )
    latest_event = mission_events[-1] if mission_events else None
    affected_drone = _get_failure_affected_drone(db, delivery, mission)
    failure_reason = delivery.failure_reason or _fallback_failure_reason(delivery.status)
    failure_source_event = latest_failure_event or latest_event

    return {
        "delivery_id": int(delivery.id) if getattr(delivery, "id", None) else None,
        "status": getattr(delivery, "status", None),
        "failure_reason": delivery.failure_reason,
        "primary_reason": failure_reason,
        "affected_drone": affected_drone,
        "what_happened": _describe_failure_event(failure_source_event, delivery, mission_events),
        "failed_step": _infer_failure_step(failure_source_event, mission),
        "latest_event": _serialize_mission_event(failure_source_event, is_failure_event=True),
        "timeline": [_serialize_mission_event(event, is_failure_event=event == failure_source_event) for event in mission_events[-5:]],
        "mission_context": [_serialize_mission_event(event, is_failure_event=event == failure_source_event) for event in mission_events[-6:]],
        "operational_impact": _build_failure_operational_impact(delivery, mission, affected_drone),
        "recommendations": _build_failure_recommendations(delivery, failure_source_event),
        "rejected_drones": [],
    }


def _fallback_failure_reason(status: Optional[str]) -> str:
    if status == DeliveryStatus.CANCELLED.value:
        return "Delivery was cancelled before completion."
    return "Delivery did not complete successfully."


def _serialize_mission_event(event: Optional[MissionEvent], is_failure_event: bool = False) -> Optional[dict]:
    if event is None:
        return None
    return {
        "event_type": event.event_type,
        "label": _failure_event_label(event.event_type),
        "details": event.details,
        "timestamp": event.timestamp.isoformat() if event.timestamp else None,
        "is_failure_event": is_failure_event,
    }


def _describe_failure_event(event: Optional[MissionEvent], delivery: Delivery, mission_events: list[MissionEvent]) -> str:
    reason_text = " ".join(filter(None, [delivery.failure_reason, event.details if event else None])).lower()
    charge_events = [ev for ev in mission_events if ev.event_type == "CHARGE"]

    if charge_events and ("battery" in reason_text or "charge" in reason_text):
        times = len(charge_events)
        plural = "times" if times != 1 else "time"
        return f"The drone stopped {times} {plural} for charging and could not complete the route afterward."
    if "weather" in reason_text or "wind" in reason_text:
        return "The assigned drone encountered unsafe weather and the mission was aborted."
    if "reassign" in reason_text:
        return "The original mission failed and automatic reassignment could not find another available drone."
    if "route" in reason_text or "blocked" in reason_text or "nfz" in reason_text:
        return "The delivery route became unavailable during execution because of route restrictions."
    if delivery.status == DeliveryStatus.CANCELLED.value:
        return "The mission was cancelled before the delivery could be completed."
    if event and event.details:
        return event.details
    if delivery.failure_reason:
        return f"The delivery failed after entering execution: {delivery.failure_reason}."
    return "The mission ended before the delivery could be completed."


def _infer_failure_step(event: Optional[MissionEvent], mission: Optional[Mission]) -> Optional[str]:
    event_type = (event.event_type if event else "") or ""
    mission_status = (mission.status if mission else "") or ""
    event_details = ((event.details if event else "") or "").lower()

    if event_type in {"CHARGE", "RESUME"} or mission_status == "charging":
        return "Charging stop"
    if event_type in {"WEATHER_HOLD"}:
        return "In transit"
    if mission_status in {"planned", "pending"}:
        return "Assignment"
    if mission_status == "en_route_pickup":
        return "Before pickup"
    if mission_status == "at_pickup":
        return "Pickup"
    if mission_status in {"en_route_delivery", "in_progress"}:
        return "In transit"
    if any(word in event_details for word in {"waypoint", "route", "weather", "delivery", "destination"}):
        return "In transit"
    if event_type in {"MISSION_ABORTED", "DELIVERY_CANCELLED"} or mission_status == "aborted":
        return "In transit"
    if event_type in {"MISSION_FAILED", "DELIVERY_FAILED"} or mission_status == "failed":
        return "In transit"
    return None


def _build_failure_recommendations(delivery: Delivery, event: Optional[MissionEvent]) -> list[str]:
    reason_text = " ".join(filter(None, [delivery.failure_reason, event.details if event else None])).lower()
    recommendations = []

    if "battery" in reason_text:
        recommendations.append("Reassign to a different drone.")
        recommendations.append("Inspect the affected drone before retrying this route.")
    if "weather" in reason_text or "wind" in reason_text:
        recommendations.append("Wait until weather conditions improve.")
    if "route" in reason_text or "blocked" in reason_text or "nfz" in reason_text:
        recommendations.append("Retry manually after reviewing route and no-fly-zone constraints.")
    if "reassign" in reason_text:
        recommendations.append("Reset the delivery status and assign manually.")
    if delivery.status == DeliveryStatus.CANCELLED.value:
        recommendations.append("Review the cancellation trigger before reassigning the order.")

    if not recommendations:
        recommendations.append("Retry manually.")

    return recommendations


def _get_failure_affected_drone(db: Session, delivery: Delivery, mission: Optional[Mission]) -> Optional[dict]:
    drone_id = getattr(delivery, "drone_id", None) or getattr(mission, "drone_id", None)
    if not drone_id:
        return None

    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if not drone:
        return {"id": int(drone_id), "name": f"Drone #{drone_id}", "status": None}

    return {
        "id": int(drone.id),
        "name": drone.name,
        "status": drone.status,
    }


def _build_failure_operational_impact(
    delivery: Delivery,
    mission: Optional[Mission],
    affected_drone: Optional[dict],
) -> list[str]:
    impact = ["Delivery not completed", "Customer not served"]

    if affected_drone:
        impact.append("Affected drone stopped before completion")
    if mission and getattr(mission, "status", None) in {"failed", "aborted"}:
        impact.append("Mission ended without successful completion")
    if delivery.status == DeliveryStatus.FAILED.value:
        impact.append("Reassignment unavailable")

    return impact


def _failure_event_label(event_type: Optional[str]) -> str:
    label_map = {
        "START": "Mission started",
        "DRONE_ASSIGNED": "Drone assigned",
        "PICKING_UP": "Heading to pickup",
        "PICKED_UP": "Reached pickup",
        "IN_TRANSIT": "Flight in progress",
        "CHARGE": "Stop at charging station",
        "RESUME": "Flight resumed",
        "MANUAL_RESUME": "Flight resumed",
        "WEATHER_HOLD": "Weather hold",
        "ARRIVED": "Arrived at destination",
        "MISSION_FAILED": "Mission failed",
        "MISSION_ABORTED": "Mission failed",
        "DELIVERY_FAILED": "Mission failed",
        "DELIVERY_CANCELLED": "Delivery cancelled",
    }
    return label_map.get(event_type or "", (event_type or "Event").replace("_", " ").title())


def _get_assignment_rejection_reason(drone: Drone, delivery: Delivery, blocked) -> Optional[str]:
    if drone.status != "idle":
        return "already busy"
    if drone.latitude is None or drone.longitude is None:
        return "location unavailable"
    if drone.battery is None or drone.battery < MIN_BATTERY_FOR_DELIVERY:
        return "battery too low"

    route_to_pickup = plan_route_leg(
        drone.latitude, drone.longitude,
        delivery.pickup_lat, delivery.pickup_lon,
        blocked,
    )
    route_to_dest = plan_route_leg(
        delivery.pickup_lat, delivery.pickup_lon,
        delivery.dest_lat, delivery.dest_lon,
        blocked,
    )


    if len(route_to_pickup) < 2 or len(route_to_dest) < 2:
        return "route blocked by NFZ"

    range_km = estimate_range_km(
        battery_pct=float(drone.battery or 0),
        max_battery_wh=float(getattr(drone, "max_battery_wh", None) or 500.0),
        battery_health=float(getattr(drone, "battery_health", None) or 100.0),
        weight_kg=_mission_weight_kg(drone, delivery),
        motor_efficiency=float(getattr(drone, "motor_efficiency", None) or 0.92),
    )

    pickup_leg_km = _route_polyline_distance_km(route_to_pickup)
    destination_leg_km = _route_polyline_distance_km(route_to_dest)
    total_route_km = pickup_leg_km + destination_leg_km

    if total_route_km <= range_km + 0.05:
        return None

    max_range_km = estimate_range_km(
        battery_pct=100.0,
        max_battery_wh=float(getattr(drone, "max_battery_wh", None) or 500.0),
        battery_health=float(getattr(drone, "battery_health", None) or 100.0),
        weight_kg=_mission_weight_kg(drone, delivery),
        motor_efficiency=float(getattr(drone, "motor_efficiency", None) or 0.92),
    )

    if pickup_leg_km > range_km + 0.05:
        chain_to_pickup = find_station_chain(
            float(drone.latitude), float(drone.longitude),
            delivery.pickup_lat, delivery.pickup_lon,
            first_leg_km=range_km,
            full_leg_km=max_range_km
        )
        if chain_to_pickup is None:
            return "insufficient range to reach pickup or nearest station"

    if destination_leg_km > range_km + 0.05:
        chain_pickup_dest = find_station_chain(
            delivery.pickup_lat, delivery.pickup_lon,
            delivery.dest_lat, delivery.dest_lon,
            first_leg_km=range_km,
            full_leg_km=max_range_km
        )
        if chain_pickup_dest is None:
            return "insufficient range to reach destination even with charging"


    combined_route_data, rejection_reason = _plan_combined_grid_route(drone, delivery, blocked)
    if combined_route_data is None:
        return rejection_reason or "route blocked by NFZ or range issues"

    return None


def _build_assignment_drone_diagnostics(drone: Drone, delivery: Delivery, blocked) -> dict:
    rejection = _get_assignment_rejection_reason(drone, delivery, blocked)
    estimated_range_km = estimate_range_km(
        battery_pct=float(drone.battery or 0),
        max_battery_wh=float(getattr(drone, "max_battery_wh", None) or 500.0),
        battery_health=float(getattr(drone, "battery_health", None) or 100.0),
        weight_kg=_mission_weight_kg(drone, delivery),
        motor_efficiency=float(getattr(drone, "motor_efficiency", None) or 0.92),
    )

    return {
        "drone_id": int(drone.id),
        "drone_name": drone.name,
        "status": drone.status,
        "status_label": _format_drone_status_label(drone.status),
        "battery": round(float(drone.battery or 0), 1),
        "estimated_range_km": round(float(estimated_range_km or 0), 1),
        "verdict": _get_assignment_verdict(rejection),
        "reason": rejection,
        "reason_label": _get_assignment_reason_label(rejection),
    }


def _build_delivery_requirements(delivery: Delivery) -> dict:
    distance_km = delivery.estimated_distance_km
    duration_h = delivery.estimated_duration_h
    if distance_km is None or duration_h is None:
        distance_km, duration_h = estimate_delivery(
            delivery.pickup_lat,
            delivery.pickup_lon,
            delivery.dest_lat,
            delivery.dest_lon,
            float(getattr(delivery, "weight_kg", None) or 1.0),
        )

    return {
        "pickup": _format_coordinates(delivery.pickup_lat, delivery.pickup_lon),
        "destination": _format_coordinates(delivery.dest_lat, delivery.dest_lon),
        "distance_km": round(float(distance_km or 0), 1),
        "priority": getattr(delivery, "priority", "normal") or "normal",
        "package_type": getattr(delivery, "package_type", "standard") or "standard",
        "weight_kg": round(float(getattr(delivery, "weight_kg", None) or 0), 1),
        "estimated_duration_h": round(float(duration_h or 0), 2),
    }


def _format_coordinates(lat: Optional[float], lon: Optional[float]) -> str:
    if lat is None or lon is None:
        return "Unavailable"
    return f"{float(lat):.4f}, {float(lon):.4f}"


def _format_drone_status_label(status: Optional[str]) -> str:
    labels = {
        "idle": "Available",
        "in_mission": "In Mission",
        "charging": "Charging",
        "going_to_charging": "Charging",
    }
    return labels.get(status or "", (status or "Unknown").replace("_", " ").title())


def _get_assignment_verdict(reason: Optional[str]) -> str:
    if reason is None:
        return "Eligible"
    verdict_map = {
        "already busy": "Busy",
        "battery too low": "Rejected",
        "insufficient range": "Not suitable",
        "route blocked by NFZ": "Not suitable",
        "location unavailable": "Rejected",
    }
    return verdict_map.get(reason, "Rejected")


def _get_assignment_reason_label(reason: Optional[str]) -> str:
    if reason is None:
        return "Eligible for automatic assignment"
    reason_map = {
        "already busy": "Already in mission",
        "battery too low": "Battery too low",
        "insufficient range": "Range insufficient",
        "route blocked by NFZ": "NFZ conflict",
        "location unavailable": "Location unavailable",
    }
    return reason_map.get(reason, reason.replace("_", " ").capitalize())


def _get_assignment_result(delivery: Delivery, eligible_drones: list[dict]) -> str:
    if delivery.status not in _ASSIGNABLE_DELIVERY_STATUSES:
        return "Auto-assignment not available"
    if eligible_drones:
        return "Manual review recommended"
    return "Auto-assignment failed"


def _build_assignment_recommendations(
    delivery: Delivery,
    primary_reason: str,
    rejected_drones: list[dict],
) -> list[str]:
    reasons = Counter(entry.get("reason") for entry in rejected_drones if entry.get("reason"))
    recommendations = []

    if delivery.status not in _ASSIGNABLE_DELIVERY_STATUSES:
        recommendations.append("Return the order to Pending before running assignment again.")
    if reasons.get("already busy"):
        recommendations.append("Wait for an available drone and retry assignment.")
    if reasons.get("battery too low") or reasons.get("insufficient range"):
        recommendations.append("Retry assignment after charging a drone with enough range.")
    if reasons.get("route blocked by NFZ"):
        recommendations.append("Review no-fly zones or rerun assignment after route conditions change.")
    if reasons.get("location unavailable"):
        recommendations.append("Restore live position telemetry for unavailable drones.")

    if not recommendations:
        recommendations.append("Assign manually or retry auto-assignment after fleet conditions change.")

    return recommendations


def _get_primary_assignment_reason(
    delivery: Delivery,
    coords_ok: bool,
    drones: list[Drone],
    eligible_drones: list[dict],
    rejected_drones: list[dict],
) -> str:
    if delivery.status not in _ASSIGNABLE_DELIVERY_STATUSES:
        return "This order is not pending and cannot be auto-assigned right now."
    if not coords_ok:
        return "Delivery coordinates are incomplete, so assignment cannot be evaluated yet."
    if not drones:
        return "No drones are registered in the fleet right now."
    if eligible_drones:
        return "At least one drone is currently eligible for this order."
    if not rejected_drones:
        return "Detailed assignment diagnostics are not available for this order yet."

    most_common_reason, _ = Counter(drone["reason"] for drone in rejected_drones).most_common(1)[0]
    primary_reason_map = {
        "already busy": "All suitable drones are busy.",
        "battery too low": "No available drone has sufficient battery for this route.",
        "insufficient range": "No drone has enough range for this route.",
        "route blocked by NFZ": "Route is blocked by restricted zones.",
        "location unavailable": "No available drone can be evaluated because live position data is missing.",
    }
    return primary_reason_map.get(most_common_reason, "The system could not automatically assign a drone.")


def _short_failure_label(reason: str) -> Optional[str]:
    """Map verbose internal reason to a short user-facing label."""
    if not reason:
        return None
    r = reason.lower()
    if any(w in r for w in ("storm", "weather")):
        return "Weather issue"
    if any(w in r for w in ("charg", "battery")):
        return "Battery constraint"
    if any(w in r for w in ("route", "stuck", "path", "safe")):
        return "Route unavailable"
    if any(w in r for w in ("reassign", "no drone", "assignment", "no available")):
        return "Assignment failed"
    return reason


def _generate_confirmation_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def _clear_demo_nfz_if_needed(db: Session, delivery: Delivery):
    """Automatically clears demo NFZs if the completed delivery was part of an NFZ demo."""
    if delivery.notes and "Demo scenario: NFZ conflict" in delivery.notes:
        from backend.models.no_fly_zone import NoFlyZone
        from backend.services.no_fly_zone_service import refresh_cache
        
        deleted = db.query(NoFlyZone).filter(NoFlyZone.name.like("NFZ Demo%")).delete(synchronize_session=False)
        if deleted > 0:
            db.commit()
            refresh_cache(db)
            try:
                from backend.routes.ws import manager
                if manager and getattr(manager, "active_connections", None):
                    manager.queue_broadcast({"type": "fleet_update", "reset_fleet": True})
                    manager.queue_broadcast({"type": "nfz_update", "reset_fleet": True})
            except Exception:
                pass


def mark_delivery_as_failed(db: Session, delivery_id: int, reason: str = None) -> bool:
    delivery = db.query(Delivery).filter(Delivery.id == delivery_id).first()
    if not delivery:
        return False
    current = get_delivery_status(delivery.status)
    if not can_transition(current, DeliveryStatus.FAILED):
        return False

    delivery.status = DeliveryStatus.FAILED.value
    delivery.completed_at = datetime.now(timezone.utc)
    delivery.failure_reason = _short_failure_label(reason)
    log_delivery_event(db, delivery, "DELIVERY_FAILED", reason)
    db.commit()
    mission_service.fail_mission(db, delivery_id, reason)
    _clear_demo_nfz_if_needed(db, delivery)
    return True


def mark_delivery_as_delivered(db: Session, delivery_id: int) -> bool:
    delivery = db.query(Delivery).filter(Delivery.id == delivery_id).first()
    if not delivery:
        return False
    current = get_delivery_status(delivery.status)
    if not can_transition(current, DeliveryStatus.DELIVERED):
        return False

    is_demo = delivery.notes and "[DEMO]" in delivery.notes

    delivery.status = DeliveryStatus.DELIVERED.value
    delivery.completed_at = datetime.now(timezone.utc)
    
    if is_demo:

        delivery.confirmed_at = datetime.now(timezone.utc)
        delivery.recipient_name = "Auto-Demo"
        delivery.confirmation_code = "DEMOOK"
    else:
        if not delivery.confirmation_code:
            delivery.confirmation_code = _generate_confirmation_code()
            
    log_delivery_event(db, delivery, "DELIVERY_COMPLETED")
    db.commit()
    mission_service.complete_mission(db, delivery_id)

    if not is_demo:
        customer = db.query(User).filter(User.id == delivery.customer_id).first()
        if customer and customer.email:
            send_delivery_confirmation_code(
                recipient_email=customer.email,
                recipient_name=customer.name,
                delivery_id=delivery.id,
                confirmation_code=delivery.confirmation_code,
            )

    _clear_demo_nfz_if_needed(db, delivery)
    return True


def cancel_delivery(db: Session, delivery_id: int, reason: str = None) -> bool:
    delivery = db.query(Delivery).filter(Delivery.id == delivery_id).first()
    if not delivery:
        return False
    current = get_delivery_status(delivery.status)
    if not can_transition(current, DeliveryStatus.CANCELLED):
        return False

    if delivery.drone_id:
        drone = db.query(Drone).filter(Drone.id == delivery.drone_id).first()
        if drone and drone.status in ("in_mission", "going_to_charging", "charging"):
            drone.status = "idle"
            drone.route_path = None
            drone.route_index = 0
            drone.dest_latitude = None
            drone.dest_longitude = None
            drone.stuck_steps = 0
        delivery.drone_id = None

    delivery.status = DeliveryStatus.CANCELLED.value
    delivery.completed_at = datetime.now(timezone.utc)
    log_delivery_event(db, delivery, "DELIVERY_CANCELLED", reason)
    db.commit()
    mission_service.abort_mission(db, delivery_id, reason or "Delivery cancelled")
    _clear_demo_nfz_if_needed(db, delivery)
    return True


def reassign_delivery(db: Session, delivery_id: int, exclude_drone_id: int = None, reason: str = None) -> bool:
    """Tries to reassign a delivery to a different drone."""
    delivery = db.query(Delivery).filter(Delivery.id == delivery_id).first()
    if not delivery:
        return False


    mission_service.abort_mission(db, delivery_id, reason=f"Reassigning: {reason}")

    old_drone_id = delivery.drone_id
    delivery.status = DeliveryStatus.PENDING.value
    delivery.drone_id = None
    db.commit()

    log_delivery_event(db, delivery, "REASSIGN_PENDING", reason or f"Reassignment: drone #{old_drone_id} unable to continue")
    if auto_assign_delivery(db, delivery, exclude_drone_id=exclude_drone_id):
        log_delivery_event(db, delivery, "REASSIGNED", f"Reassigned from drone #{old_drone_id} to drone #{delivery.drone_id}")
        return True

    delivery.status = DeliveryStatus.FAILED.value
    delivery.completed_at = datetime.now(timezone.utc)
    delivery.failure_reason = "Assignment failed"
    log_delivery_event(db, delivery, "DELIVERY_FAILED", f"Reassignment failed: no drone available")
    db.commit()
    return False


def manual_reassign_delivery_locked(db: Session, delivery_id: int, drone_id: int, user_email: str) -> bool:
    """Manually reassigns a delivery to a specific drone with full safety checks."""
    from backend.services.no_fly_zone_service import get_blocked_cells
    from backend.services.grid import city_grid as _city_grid
    
    with _assignment_lock:
        delivery = db.query(Delivery).filter(Delivery.id == delivery_id).first()
        if not delivery:
            return False

        drone = db.query(Drone).filter(Drone.id == drone_id).first()
        if not drone or drone.status != "idle":
            return False


        mission_service.abort_mission(db, delivery_id, reason=f"Manual reassignment by {user_email}")


        blocked = get_blocked_cells(_city_grid)
        planned_data, rejection_reason = _plan_combined_grid_route(drone, delivery, blocked)
        if not planned_data:
            print(f"Manual assignment failed: {rejection_reason}")
            return False
            
        combined_route, route_total_km, pickup_waypoint_index, charging_stops, weather_penalty = planned_data


        drone.route_path = [[p[0], p[1]] for p in combined_route]
        drone.planned_route_path = [[p[0], p[1]] for p in combined_route]
        drone.route_index = 0
        
        print("=== ROUTE ASSIGNED (MANUAL) ===")
        print("Drone:", drone.id, drone.name)
        print("Route points:", len(drone.route_path))
        print("Start:", drone.route_path[0])
        print("End:", drone.route_path[-1])
        print("Full route:", drone.route_path)

        drone.dest_latitude = float(delivery.dest_lat)
        drone.dest_longitude = float(delivery.dest_lon)
        drone.status = "in_mission"
        drone.stuck_steps = 0
        drone.charge_count = 0


        delivery.drone_id = drone.id
        delivery.status = DeliveryStatus.ASSIGNED.value
        if not delivery.confirmation_code:
            delivery.confirmation_code = _generate_confirmation_code()

        db.commit()


        mission_service.create_mission(
            db,
            drone_id=drone.id,
            delivery_id=delivery.id,
            estimated_distance_km=float(delivery.estimated_distance_km or route_total_km),
            estimated_duration_h=float(delivery.estimated_duration_h or 0.0),
            total_distance_km=float(route_total_km),
            pickup_waypoint_index=pickup_waypoint_index,
            planned_route_path=[[p[0], p[1]] for p in combined_route],
        )


        from backend.services.audit_service import log_delivery_reassigned
        from backend.models.user import User
        from backend.routes.ws import manager
        user = db.query(User).filter(User.email == user_email).first()
        log_delivery_reassigned(db, delivery, old_drone=None, new_drone=drone, user=user)


        manager.queue_broadcast({
            "type": "drone_update",
            "drone_id": int(drone.id),
            "status": drone.status,
            "latitude": drone.latitude,
            "longitude": drone.longitude,
            "battery": drone.battery,
            "route_index": int(drone.route_index or 0),
            "route_path": drone.route_path if isinstance(drone.route_path, list) else None,
            "planned_route_path": drone.planned_route_path if isinstance(drone.planned_route_path, list) else None,
            "delivery_id": int(delivery.id),
        })

        return True


def build_delivery_timeline(db: Session, delivery: Delivery) -> dict:
    """Builds the full timeline of a delivery."""
    from backend.models.mission import Mission
    from backend.models.mission_event import MissionEvent

    STATUS_STEPS = [
        ("CREATED",     "Delivery created"),
        ("ASSIGNED",    "Drone assigned"),
        ("PICKING_UP",  "En route to pickup"),
        ("PICKED_UP",   "Package picked up"),
        ("IN_TRANSIT",  "In transit to destination"),
        ("DELIVERED",   "Delivery completed"),
    ]
    TERMINAL_STEPS = {"cancelled": ("CANCELLED", "Delivery cancelled"), "failed": ("FAILED", "Delivery failed")}

    missions = db.query(Mission).filter(Mission.delivery_id == delivery.id).all()
    all_events = []
    for m in missions:
        events = db.query(MissionEvent).filter(MissionEvent.mission_id == m.id).order_by(MissionEvent.timestamp).all()
        all_events.extend(events)
    all_events.sort(key=lambda e: e.timestamp)

    step_timestamps = {"CREATED": delivery.created_at}
    event_type_to_step = {
        "DRONE_ASSIGNED": "ASSIGNED", "PICKING_UP": "PICKING_UP", "PICKED_UP": "PICKED_UP",
        "IN_TRANSIT": "IN_TRANSIT", "DELIVERY_COMPLETED": "DELIVERED", "ARRIVED": "DELIVERED",
        "DELIVERY_FAILED": "FAILED", "DELIVERY_CANCELLED": "CANCELLED",
    }
    for ev in all_events:
        step_key = event_type_to_step.get(ev.event_type)
        if step_key and step_key not in step_timestamps:
            step_timestamps[step_key] = ev.timestamp

    current = delivery.status
    active_step_key = {
        "pending": "CREATED", "assigned": "ASSIGNED", "picking_up": "PICKING_UP",
        "picked_up": "PICKED_UP", "in_transit": "IN_TRANSIT", "in_progress": "IN_TRANSIT",
        "delivered": "DELIVERED", "cancelled": "CANCELLED", "failed": "FAILED",
    }.get(current, "CREATED")

    steps_list = list(STATUS_STEPS)
    if current in TERMINAL_STEPS and current != "delivered":
        steps_list.append(TERMINAL_STEPS[current])

    step_order = [s[0] for s in steps_list]
    active_idx = step_order.index(active_step_key) if active_step_key in step_order else 0

    steps = []
    for i, (key, label) in enumerate(steps_list):
        ts = step_timestamps.get(key)
        completed = i < active_idx or (i == active_idx and current in ("delivered", "cancelled", "failed"))
        active = i == active_idx and current not in ("delivered", "cancelled", "failed")
        steps.append({"step": key, "label": label, "timestamp": ts, "completed": completed, "active": active})

    secondary_types = {"CHARGE", "WEATHER_HOLD", "RESUME", "REASSIGN_PENDING", "REASSIGNED", "FAILED"}
    secondary_labels = {
        "CHARGE": "Stop at charging station", "WEATHER_HOLD": "Flight suspended — weather",
        "RESUME": "Flight resumed after charging", "REASSIGN_PENDING": "Reassignment in progress",
        "REASSIGNED": "Reassigned to another drone", "FAILED": "Mission error",
    }
    events_out = []
    for ev in all_events:
        if ev.event_type in secondary_types:
            events_out.append({"event_type": ev.event_type, "label": secondary_labels.get(ev.event_type, ev.event_type), "timestamp": ev.timestamp, "details": ev.details})

    return {"delivery_id": delivery.id, "current_status": current, "steps": steps, "events": events_out}


def explain_drone_rejection(db: Session, drone_id: int, delivery: Delivery) -> dict:
    """Explains why a specific drone was not chosen for a delivery."""
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if not drone:
        return {"drone_id": drone_id, "found": False, "reason": "Drone not found"}

    blocked = get_blocked_cells(city_grid)
    rejection_reason = _get_assignment_rejection_reason(drone, delivery, blocked)

    checks = []
    checks.append({"check": "Status is idle", "passed": drone.status == "idle", "value": drone.status})
    checks.append({"check": "Valid coordinates", "passed": drone.latitude is not None, "value": f"({drone.latitude}, {drone.longitude})"})
    checks.append({"check": f"Battery >= {MIN_BATTERY_FOR_DELIVERY}%", "passed": (drone.battery or 0) >= MIN_BATTERY_FOR_DELIVERY, "value": f"{drone.battery}%"})

    if drone.latitude is not None and delivery.pickup_lat is not None:
        dist_to_pickup = haversine_distance(drone.latitude, drone.longitude, delivery.pickup_lat, delivery.pickup_lon)
        dist_to_dest = haversine_distance(delivery.pickup_lat, delivery.pickup_lon, delivery.dest_lat, delivery.dest_lon)
        total = dist_to_pickup + dist_to_dest

        from backend.services.battery_service import estimate_range_km as _est_range
        w = _mission_weight_kg(drone, delivery)
        range_km = _est_range(battery_pct=float(drone.battery or 0), weight_kg=w)

        checks.append({"check": "Autonomy vs distance", "passed": range_km >= dist_to_pickup * 1.12, "value": f"Autonomy {range_km:.1f} km, pickup {dist_to_pickup:.1f} km"})

        planned = _plan_combined_grid_route(drone, delivery, blocked)
        checks.append({"check": "Feasible grid route", "passed": planned is not None, "value": f"Route found: {planned is not None}"})

    return {
        "drone_id": drone_id,
        "drone_name": drone.name,
        "found": True,
        "reason": rejection_reason,
        "checks": checks,
        "would_be_selected": rejection_reason is None and all(c["passed"] for c in checks),
    }
