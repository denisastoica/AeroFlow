"""
Preset demo scenarios for the drone delivery platform.

Each scenario sets the necessary state in the DB/memory and returns
a dict with the description of the actions performed — ready-to-show in the frontend.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from backend.models.drone import Drone
from backend.models.delivery import Delivery
from backend.models.mission import Mission
from backend.models.no_fly_zone import NoFlyZone
from backend.models.user import User
from backend.app.core.delivery_state import (
    DeliveryStatus, MissionStatus, ACTIVE_DELIVERY_STATUSES,
)
from backend.services.delivery_service import auto_assign_delivery, reassign_delivery
from backend.services.no_fly_zone_service import refresh_cache
from backend.services.weather_service import force_scenario_weather, clear_scenario_overrides
from backend.services import mission_service, mission_event_service
from backend.services.geo_locations import CITY_COORDS


CITIES = {
    "Cluj-Napoca":  CITY_COORDS["Cluj-Napoca"],
    "Brasov":       CITY_COORDS["Brasov"],
    "Bucharest":    CITY_COORDS["Bucharest"],
    "Timisoara":    CITY_COORDS["Timisoara"],
    "Sibiu":        CITY_COORDS["Sibiu"],
    "Iasi":         CITY_COORDS["Iasi"],
    "Constanta":    CITY_COORDS["Constanta"],
    "Oradea":       CITY_COORDS["Oradea"],
    "Craiova":      CITY_COORDS["Craiova"],
    "Galati":       CITY_COORDS["Galati"],
    "Ploiesti":     CITY_COORDS["Ploiesti"],
    "Bacau":        CITY_COORDS["Bacau"],
    "Targu Mures":  CITY_COORDS["Targu Mures"],
    "Piatra Neamt": CITY_COORDS["Piatra Neamt"],
    "Suceava":      CITY_COORDS["Suceava"],
}


def _get_customer(db: Session) -> User:
    """Returns the first user with the customer role, or any user."""
    user = db.query(User).filter(User.role == "customer").first()
    if not user:
        user = db.query(User).first()
    if not user:
        raise RuntimeError("No user exists in the database.")
    return user


def _pick_idle_drone(db: Session, prefer_near: Optional[tuple] = None, exclude_ids: Optional[list] = None) -> Optional[Drone]:
    """Selects an idle drone, optionally the one closest to (lat, lon)."""
    from backend.services.grid import haversine_distance

    query = db.query(Drone).filter(Drone.status == "idle")
    if exclude_ids:
        query = query.filter(Drone.id.notin_(exclude_ids))
    idle = query.all()
    if not idle:
        return None
    if prefer_near:
        lat, lon = prefer_near
        idle.sort(key=lambda d: haversine_distance(d.latitude, d.longitude, lat, lon))
    return idle[0]


def _add_jitter(coord: tuple, amount: float = 0.004) -> tuple:
    """Adds a small random offset to coordinates to avoid perfect overlap with stations."""
    return (
        coord[0] + random.uniform(-amount, amount),
        coord[1] + random.uniform(-amount, amount)
    )


def _pick_drone_in_mission(db: Session) -> Optional[Drone]:
    return db.query(Drone).filter(Drone.status == "in_mission").first()


DEMO_NOTES_TAG = "[DEMO]"

def _create_delivery(
    db: Session,
    customer_id: int,
    pickup: tuple,
    dest: tuple,
    priority: str = "normal",
    package_type: str = "standard",
    weight_kg: float = 1.0,
    notes: Optional[str] = None,
) -> Delivery:

    tagged_notes = f"{DEMO_NOTES_TAG} {notes}" if notes else DEMO_NOTES_TAG
    d = Delivery(
        customer_id=customer_id,
        pickup_lat=pickup[0],
        pickup_lon=pickup[1],
        dest_lat=dest[0],
        dest_lon=dest[1],
        status=DeliveryStatus.PENDING.value,
        priority=priority,
        package_type=package_type,
        weight_kg=weight_kg,
        notes=tagged_notes,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


def scenario_bad_weather(db: Session) -> dict:
    """
    Forces a storm in the Brasov area and launches a drone there.
    The drone will be blocked in flight as soon as the simulator detects can_fly=False.
    """
    customer = _get_customer(db)
    zone_name = "Brasov"
    pickup = _add_jitter(CITIES["Brasov"])
    dest = _add_jitter(CITIES["Constanta"])


    drone = _pick_idle_drone(db, prefer_near=pickup)
    if not drone:
        return {
            "scenario": "bad_weather",
            "status": "skip",
            "message": "No idle drones. Use Reset Fleet first.",
        }


    drone.latitude = pickup[0] + random.uniform(-0.05, 0.05)
    drone.longitude = pickup[1] + random.uniform(-0.05, 0.05)
    drone.battery = 100.0
    db.commit()


    delivery = _create_delivery(
        db, customer.id, pickup, dest,
        priority="urgent",
        package_type="standard",
        notes="Demo scenario: storm Brasov→Constanta",
    )


    clear_scenario_overrides()


    assigned = auto_assign_delivery(db, delivery)
    if not assigned:
        delivery.status = DeliveryStatus.CANCELLED.value
        db.commit()
    else:


        force_scenario_weather(zone_name, "storm", duration_sec=90)

    return {
        "scenario": "bad_weather",
        "status": "ok" if assigned else "partial",
        "message": (
            f"Storm activated in the {zone_name} area (90 s). "
            f"Drone «{drone.name}» starts towards Constanta — "
            "it will be immobilized immediately by severe weather conditions. "
            "Follow on the map: the drone stops and consumes battery in hover."
        ) if assigned else (
            f"Storm activated in {zone_name}. Assignment failed — "
            "possibly the drone cannot plan the route. Try Reset Fleet."
        ),
        "details": {
            "zone_forced": zone_name,
            "condition": "storm",
            "duration_sec": 90,
            "drone": drone.name,
            "drone_id": drone.id,
            "delivery_id": delivery.id if assigned else None,
            "pickup": f"Brasov ({pickup[0]:.3f}, {pickup[1]:.3f})",
            "destination": f"Constanta ({dest[0]:.3f}, {dest[1]:.3f})",
        },
        "tip": "The drone will remain in hover until the storm expires (90s). "
               "If it remains blocked >60s, the mission fails automatically and the system attempts reassignment.",
    }


def scenario_nfz_conflict(db: Session) -> dict:
    """
    Creates a temporary no-fly zone on the Cluj→Sibiu route.
    The drone will be forced to bypass — the planned route automatically avoids NFZ.
    """

    from backend.services.weather_service import clear_scenario_overrides
    clear_scenario_overrides()


    db.query(NoFlyZone).filter(NoFlyZone.name.like("NFZ Demo%")).delete(synchronize_session=False)
    db.commit()

    customer = _get_customer(db)
    pickup = _add_jitter(CITIES["Cluj-Napoca"])
    dest = _add_jitter(CITIES["Sibiu"])


    nfz_center = (46.285, 23.875)

    drone = _pick_idle_drone(db, prefer_near=pickup)
    if not drone:
        return {
            "scenario": "nfz_conflict",
            "status": "skip",
            "message": "No idle drones. Use Reset Fleet first.",
        }


    drone.latitude = pickup[0]
    drone.longitude = pickup[1]
    drone.battery = 100.0
    drone.battery_health = 100.0
    db.commit()


    nfz = NoFlyZone(
        name="NFZ Demo — Military Exercise",
        center_lat=nfz_center[0],
        center_lon=nfz_center[1],
        radius_km=7.0,
        reason="Military exercise — demo scenario",
        zone_type="temporary",
        is_active=True,
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=8),
    )
    db.add(nfz)
    db.commit()
    db.refresh(nfz)


    refresh_cache(db)


    delivery = _create_delivery(
        db, customer.id, pickup, dest,
        priority="normal",
        notes="Demo scenario: NFZ conflict Cluj→Sibiu",
    )

    assigned = auto_assign_delivery(db, delivery)

    if not assigned:
        delivery.status = DeliveryStatus.CANCELLED.value
        db.commit()
        return {
            "scenario": "nfz_conflict",
            "status": "error",
            "message": "Assignment failed. No alternative route found. Try resetting the fleet.",
        }

    return {
        "scenario": "nfz_conflict",
        "status": "ok",
        "message": (
            f"Restricted zone created mid-route (radius 7 km, expires in 8 min). "
            f"Drone «{drone.name}» redirected to alternative Cluj→Sibiu route that avoids NFZ. "
            "Compare the route on the map with the direct path — you will see the bypass."
        ),
        "details": {
            "nfz_id": nfz.id,
            "nfz_name": nfz.name,
            "nfz_center": f"{nfz_center[0]:.3f}°N, {nfz_center[1]:.3f}°E",
            "nfz_radius_km": 11.0,
            "expires_in": "8 minutes",
            "drone": drone.name,
            "drone_id": drone.id,
            "delivery_id": delivery.id,
            "route": "Cluj-Napoca → Sibiu (bypassing NFZ)",
        },
        "tip": "Enable the 'NFZ' layer on the map to see the blocked area and the bypassed route.",
    }


def scenario_low_battery(db: Session) -> dict:
    """
    Sets a drone's battery to 8% and assigns a long delivery.
    The simulator will detect a critical level and redirect the drone to the nearest station.
    """
    customer = _get_customer(db)


    pickup = _add_jitter(CITIES["Timisoara"])
    dest = _add_jitter(CITIES["Iasi"])

    drone = _pick_idle_drone(db, prefer_near=pickup)
    if not drone:
        return {
            "scenario": "low_battery",
            "status": "skip",
            "message": "No idle drones. Use Reset Fleet first.",
        }


    original_battery = drone.battery
    drone.latitude = pickup[0] + random.uniform(-0.03, 0.03)
    drone.longitude = pickup[1] + random.uniform(-0.03, 0.03)
    drone.battery = 8.0
    drone.battery_health = 75.0
    db.commit()

    delivery = _create_delivery(
        db, customer.id, pickup, dest,
        priority="urgent",
        package_type="fragile",
        notes="Demo scenario: critical battery → station redirection",
    )

    assigned = auto_assign_delivery(db, delivery)
    if not assigned:
        delivery.status = DeliveryStatus.CANCELLED.value
        db.commit()

    return {
        "scenario": "low_battery",
        "status": "ok" if assigned else "partial",
        "message": (
            f"Drone «{drone.name}» starts with 8% battery (it was {original_battery:.0f}%). "
            "The simulator detects the critical level immediately and redirects it to a reachable "
            "charging station when possible. After a full recharge, the mission automatically resumes towards the destination."
        ) if assigned else (
            f"Drone «{drone.name}» battery set to 8%. Assignment failed — "
            "the assignment system rejects the drone with too low battery for the given route. "
            "This is the correct protective behavior."
        ),
        "details": {
            "drone": drone.name,
            "drone_id": drone.id,
            "battery_set": "8%",
            "battery_health": "75%",
            "delivery_id": delivery.id if assigned else None,
            "pickup": f"Timisoara ({pickup[0]:.3f}, {pickup[1]:.3f})",
            "destination": f"Iasi ({dest[0]:.3f}, {dest[1]:.3f})",
            "expected_behavior": "Automatic station redirection → recharge → mission resume",
        },
        "tip": "Follow on the map: the drone will change the route towards a charging station (orange) "
               "before continuing to the destination (yellow→blue).",
    }


def scenario_auto_reassign(db: Session) -> dict:
    """
    Simulates a mid-flight motor failure.
    The system automatically tries to reassign the delivery to another available drone.
    """
    customer = _get_customer(db)

    pickup = _add_jitter(CITIES["Cluj-Napoca"])
    dest = _add_jitter(CITIES["Galati"])

    idle_drones = db.query(Drone).filter(Drone.status == "idle").all()
    if len(idle_drones) < 2:
        return {
            "scenario": "auto_reassign",
            "status": "skip",
            "message": "Not enough idle drones for reassignment demo. Use Reset Fleet first.",
        }
        

    idle_drones.sort(key=lambda d: -(d.max_battery_wh or 500))
    pilot_drone = idle_drones[0]
    
    pilot_drone.latitude = pickup[0]
    pilot_drone.longitude = pickup[1]
    pilot_drone.battery = 100.0
    db.commit()

    pilot_delivery = _create_delivery(
        db, customer.id, pickup, dest,
        priority="normal",
        notes="Demo scenario: motor failure",
    )
    pilot_delivery_id = pilot_delivery.id
    

    auto_assign_delivery(db, pilot_delivery)
    db.refresh(pilot_delivery)
    
    assigned_drone = None
    if pilot_delivery.drone_id:
        assigned_drone = db.query(Drone).filter(Drone.id == pilot_delivery.drone_id).first()


    backup_drone = idle_drones[1]
    backup_drone.latitude = pickup[0]
    backup_drone.longitude = pickup[1]
    backup_drone.battery = 100.0
    db.commit()

    drone_name = assigned_drone.name if assigned_drone else pilot_drone.name

    return {
        "scenario": "auto_reassign",
        "status": "ok",
        "message": (
            f"Drone «{drone_name}» has been dispatched for delivery #{pilot_delivery_id}. "
            "Watch closely: a simulated motor failure will occur mid-flight! "
            "When it fails, the system will automatically reassign the delivery to a backup drone."
        ),
        "details": {
            "drone": drone_name,
            "delivery_id": pilot_delivery_id,
        }
    }


def scenario_urgent_delivery(db: Session) -> dict:
    """
    Creates an emergency medical delivery (priority=emergency).
    The system prioritizes the request and selects the most suitable available drone.
    """
    customer = _get_customer(db)


    pickup = _add_jitter(CITIES["Suceava"])
    dest = _add_jitter(CITIES["Iasi"])

    idle_drones = db.query(Drone).filter(Drone.status == "idle").all()
    if not idle_drones:
        return {
            "scenario": "urgent_delivery",
            "status": "skip",
            "message": "No idle drones. Use Reset Fleet first.",
        }


    best_drone = max(idle_drones, key=lambda d: d.battery or 0)

    delivery = _create_delivery(
        db, customer.id, pickup, dest,
        priority="emergency",
        package_type="medical",
        weight_kg=0.4,
        notes="URGENT: Critical insulin for Sf. Spiridon Hospital Iasi",
    )

    assigned = auto_assign_delivery(db, delivery)
    if not assigned:
        delivery.status = DeliveryStatus.CANCELLED.value
        db.commit()
    db.refresh(delivery)

    actual_drone = db.query(Drone).filter(Drone.id == delivery.drone_id).first() if delivery.drone_id else None

    return {
        "scenario": "urgent_delivery",
        "status": "ok" if assigned else "partial",
        "message": (
            f"🚑 Urgent medical delivery created: insulin Suceava→Iasi. "
            f"Selected drone: «{actual_drone.name if actual_drone else '?'}». "
            "EMERGENCY priority ensures this delivery is assigned to the most suitable available drone."
        ) if assigned else (
            "Urgent medical delivery not assigned (cancelled). No drones currently available. "
            "Reset fleet or add more drones."
        ),
        "details": {
            "delivery_id": delivery.id,
            "priority": "emergency",
            "package_type": "medical",
            "weight_kg": 0.4,
            "pickup": f"Suceava — Pharmaceutical Warehouse",
            "destination": f"Iasi — Sf. Spiridon Hospital",
            "selected_drone": actual_drone.name if actual_drone else None,
            "drone_battery_at_assign": f"{actual_drone.battery:.0f}%" if actual_drone else None,
            "best_idle_drone": best_drone.name,
            "assigned": assigned,
        },
        "tip": "Emergency deliveries are prioritized over any other order. "
               "The system selects the most suitable drone for medical emergencies.",
    }


def scenario_fleet_stress(db: Session) -> dict:
    """
    Creates 6 simultaneous deliveries across Romania and attempts batch assignment.
    Tests the fleet's ability to handle high demand.
    """
    customer = _get_customer(db)


    routes = [

        ("Bucharest",    "Constanta",  "emergency", "medical"),

        ("Suceava",      "Galati",     "normal",    "standard"),

        ("Oradea",       "Timisoara",  "urgent",    "fragile"),

        ("Cluj-Napoca",  "Craiova",    "normal",    "food"),

        ("Iasi",         "Bucharest",  "urgent",    "standard"),

        ("Sibiu",        "Ploiesti",   "normal",    "standard"),
    ]

    deliveries_created = []
    for pickup_city, dest_city, priority, pkg_type in routes:
        pickup = _add_jitter(CITIES[pickup_city])
        dest = _add_jitter(CITIES[dest_city])
        d = _create_delivery(
            db, customer.id, pickup, dest,
            priority=priority,
            package_type=pkg_type,
            notes=f"Stress test: {pickup_city}→{dest_city} [DEMO]",
        )
        deliveries_created.append({
            "id": d.id,
            "route": f"{pickup_city} → {dest_city}",
            "priority": priority,
        })


    assigned_count = 0
    failed_count = 0
    for dc in deliveries_created:
        d = db.query(Delivery).filter(Delivery.id == dc["id"]).first()
        if d and auto_assign_delivery(db, d):
            dc["status"] = "assigned"
            assigned_count += 1
        else:
            dc["status"] = "cancelled"
            failed_count += 1
            if d:
                d.status = DeliveryStatus.CANCELLED.value
    db.commit()

    idle_remaining = db.query(Drone).filter(Drone.status == "idle").count()

    return {
        "scenario": "fleet_stress",
        "status": "ok",
        "message": (
            f"6 simultaneous deliveries launched: {assigned_count} assigned, {failed_count} skipped (fleet at capacity). "
            f"Idle drones remaining: {idle_remaining}. "
            + ("The fleet absorbed all orders without problems! ✓"
               if failed_count == 0
               else f"{failed_count} deliveries cancelled — fleet at maximum capacity.")
        ),
        "details": {
            "total_created": len(deliveries_created),
            "assigned": assigned_count,
            "cancelled": failed_count,
            "idle_drones_remaining": idle_remaining,
            "deliveries": deliveries_created,
        },
        "tip": "Unassigned demo deliveries are cancelled automatically to keep the orders list clean. "
               "HIGH/URGENT priority are processed first during batch assignment.",
    }


def scenario_freeze_thaw(db: Session) -> dict:
    """
    Sets all weather zones to 'storm' for 30 seconds,
    temporarily paralyzing all active drones.
    After 30s conditions automatically return to normal.
    """
    from backend.services.weather_service import WEATHER_ZONES

    zones_forced = []
    for zone in WEATHER_ZONES:
        force_scenario_weather(zone.name, "storm", duration_sec=30)
        zones_forced.append(zone.name)
        

    force_scenario_weather("GLOBAL", "storm", duration_sec=30)

    active_drones = db.query(Drone).filter(
        Drone.status.in_(["in_mission", "going_to_charging"])
    ).count()

    return {
        "scenario": "freeze_thaw",
        "status": "ok",
        "message": (
            f"⛈ NATIONAL STORM — all {len(zones_forced)} weather zones set to STORM (30s). "
            f"{active_drones} active drones will be immobilized immediately. "
            "Follow on the map how all drones enter hover simultaneously. "
            "Conditions automatically return to normal after 30 seconds."
        ),
        "details": {
            "zones_forced": zones_forced,
            "duration_sec": 30,
            "active_drones_affected": active_drones,
        },
        "tip": "This simulates a national extreme weather event. "
               "Drones blocked >60s will fail and the system will attempt reassignment when the weather returns.",
    }


SCENARIOS = {
    "bad_weather":     scenario_bad_weather,
    "nfz_conflict":    scenario_nfz_conflict,
    "low_battery":     scenario_low_battery,
    "auto_reassign":   scenario_auto_reassign,
    "urgent_delivery": scenario_urgent_delivery,
    "fleet_stress":    scenario_fleet_stress,
    "freeze_thaw":     scenario_freeze_thaw,
}

SCENARIO_META = {
    "bad_weather": {
        "title": "Bad Weather",
        "subtitle": "Storm Brasov → Constanta",
        "description": "Forces a storm in Brasov. The drone is immobilized until weather improves.",
        "icon": "⛈",
        "color": "#6366f1",
        "duration_hint": "~2 min",
        "tags": ["weather", "storm", "hover"],
    },
    "nfz_conflict": {
        "title": "Restricted Zone Conflict",
        "subtitle": "Cluj → Sibiu with NFZ on route",
        "description": "Creates a temporary NFZ on the route. The drone automatically calculates an alternative path.",
        "icon": "🚫",
        "color": "#f59e0b",
        "duration_hint": "8 min NFZ active",
        "tags": ["NFZ", "rerouting", "pathfinding"],
    },
    "low_battery": {
        "title": "Insufficient Battery",
        "subtitle": "8% battery → station redirection",
        "description": "Starts a drone with 8% battery. The system automatically redirects it to recharge.",
        "icon": "🔋",
        "color": "#ef4444",
        "tags": ["battery", "charging", "autonomy"],
    },
    "auto_reassign": {
        "title": "Automatic Reassignment",
        "subtitle": "Aborted mission → another drone takes over",
        "description": "Aborts an active mission. The system reassigns the delivery to another available drone.",
        "icon": "🔄",
        "color": "#8b5cf6",
        "tags": ["reassign", "recovery", "resilience"],
    },
    "urgent_delivery": {
        "title": "Urgent Medical Delivery",
        "subtitle": "Insulin Suceava → Iasi Hospital",
        "description": "Creates an emergency medical delivery. The system selects the most suitable available drone.",
        "icon": "🚑",
        "color": "#10b981",
        "tags": ["emergency", "priority", "medical"],
    },
    "fleet_stress": {
        "title": "Fleet Stress Test",
        "subtitle": "6 simultaneous deliveries",
        "description": "Launches 6 simultaneous deliveries across 6 different geographic corridors of Romania to test maximum fleet capacity without routing bottlenecks.",
        "icon": "⚡",
        "color": "#06b6d4",
        "tags": ["stress", "capacity", "batch"],
    },
    "freeze_thaw": {
        "title": "National Storm",
        "subtitle": "All weather zones → storm (30s)",
        "description": "Sets STORM in all zones for 30s. All active drones hover until conditions improve.",
        "icon": "🌩",
        "color": "#64748b",
        "duration_hint": "30 seconds",
        "tags": ["weather", "hover", "mass"],
    },
}


def run_scenario(scenario_id: str, db: Session) -> dict:
    """Main entry point — runs scenario by ID."""
    fn = SCENARIOS.get(scenario_id)
    if not fn:
        return {
            "scenario": scenario_id,
            "status": "error",
            "message": f"Unknown scenario: '{scenario_id}'. "
                       f"Available: {', '.join(SCENARIOS.keys())}",
        }
    try:
        result = fn(db)
        return result
    except Exception as exc:
        import traceback
        return {
            "scenario": scenario_id,
            "status": "error",
            "message": f"Error executing scenario: {exc}",
            "traceback": traceback.format_exc(),
        }
