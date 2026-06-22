"""
Demo fleet presets + reset: all drones idle, missions closed, active deliveries → pending.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Tuple

from sqlalchemy.orm import Session

from backend.models.drone import Drone
from backend.models.delivery import Delivery
from backend.models.mission import Mission
from backend.models.no_fly_zone import NoFlyZone
from backend.app.core.delivery_state import DeliveryStatus, MissionStatus
from backend.services.geo_locations import CITY_COORDS


DEMO_DRONE_PRESETS: List[Tuple[str, float, float]] = [

    ("Drone Alpha",   *CITY_COORDS["Cluj-Napoca"]),
    ("Drone Beta",    *CITY_COORDS["Brasov"]),
    ("Drone Gamma",   *CITY_COORDS["Targu Mures"]),
    ("Drone Delta",   *CITY_COORDS["Sibiu"]),
    ("Drone Epsilon", *CITY_COORDS["Bistrita"]),

    ("Drone Zeta",    *CITY_COORDS["Timisoara"]),
    ("Drone Eta",     *CITY_COORDS["Arad"]),
    ("Drone Theta",   *CITY_COORDS["Oradea"]),

    ("Drone Iota",    *CITY_COORDS["Iasi"]),
    ("Drone Kappa",   *CITY_COORDS["Piatra Neamt"]),
    ("Drone Lambda",  *CITY_COORDS["Suceava"]),

    ("Drone Mu",      *CITY_COORDS["Bucharest"]),
    ("Drone Nu",      *CITY_COORDS["Craiova"]),
    ("Drone Xi",      *CITY_COORDS["Ploiesti"]),

    ("Drone Omicron", *CITY_COORDS["Constanta"]),
    ("Drone Pi",      *CITY_COORDS["Galati"]),
    

    ("Drone Sigma",   *CITY_COORDS["Baia Mare"]),
    ("Drone Orion",   *CITY_COORDS["Bacau"]),
    ("Drone Nova",    *CITY_COORDS["Targu Jiu"]),
    ("Drone Phoenix", *CITY_COORDS["Fagaras"]),
]

DEFAULT_MIN_FLEET = 16


def ensure_minimum_drones(db: Session, min_count: int = DEFAULT_MIN_FLEET) -> dict:
    """
    Adds drones from presets up to `min_count` (skips already existing names).
    """
    total = db.query(Drone).count()
    if total >= min_count:
        return {"added": 0, "total": total, "target": min_count}

    existing_names = {n for (n,) in db.query(Drone.name).all()}
    added = 0
    for name, lat, lon in DEMO_DRONE_PRESETS:
        if total + added >= min_count:
            break
        if name in existing_names:
            continue
        db.add(
            Drone(
                name=name,
                latitude=lat,
                longitude=lon,
                battery=100.0,
                status="idle",
            )
        )
        existing_names.add(name)
        added += 1

    if added:
        db.commit()

    final = db.query(Drone).count()
    return {"added": added, "total": final, "target": min_count}


def reset_fleet_for_demo(db: Session) -> dict:
    """
    Closes open missions, sets assigned/in_progress deliveries back to pending,
    resets all drones to idle (100% battery, no route).
    """
    now = datetime.now(timezone.utc)

    open_missions = db.query(Mission).filter(Mission.end_time.is_(None)).all()
    for m in open_missions:
        m.end_time = now
        if m.start_time:
            start = m.start_time if m.start_time.tzinfo else m.start_time.replace(tzinfo=timezone.utc)
            m.actual_duration_h = (now - start).total_seconds() / 3600.0
        m.status = MissionStatus.FAILED.value


    from sqlalchemy import or_
    _demo_filters = or_(
        Delivery.notes.like("%[DEMO]%"),
        Delivery.notes.like("Demo scenario:%"),
        Delivery.notes.like("Stress test:%"),
        Delivery.notes.like("URGENT: Critical insulin%"),
    )
    demo_cancelled = 0
    for d in db.query(Delivery).filter(_demo_filters).all():
        if d.status not in (DeliveryStatus.DELIVERED.value, DeliveryStatus.CANCELLED.value):
            d.status = DeliveryStatus.CANCELLED.value
            d.drone_id = None
            d.completed_at = datetime.now(timezone.utc)
            demo_cancelled += 1


    deliveries_reset = 0
    for d in (
        db.query(Delivery)
        .filter(
            Delivery.status.in_(
                [
                    DeliveryStatus.ASSIGNED.value,
                    DeliveryStatus.PICKING_UP.value,
                    DeliveryStatus.PICKED_UP.value,
                    DeliveryStatus.IN_TRANSIT.value,
                    DeliveryStatus.IN_PROGRESS.value,
                ]
            ),
            ~_demo_filters,
        )
        .all()
    ):
        d.status = DeliveryStatus.PENDING.value
        d.drone_id = None
        deliveries_reset += 1

    preset_by_name = {
        name: (lat, lon)
        for name, lat, lon in DEMO_DRONE_PRESETS
    }
    
    preset_by_suffix = {
        name.split()[-1]: (lat, lon)
        for name, lat, lon in DEMO_DRONE_PRESETS
    }

    drones_reset = 0
    for drone in db.query(Drone).all():
        drone.status = "idle"
        drone.battery = 100.0
        drone.route_path = None
        drone.planned_route_path = None
        drone.route_index = 0
        drone.dest_latitude = None
        drone.dest_longitude = None
        drone.stuck_steps = 0
        drone.charge_count = 0

        suffix = drone.name.split()[-1] if drone.name else ""
        if suffix in preset_by_suffix:
            drone.latitude, drone.longitude = preset_by_suffix[suffix]
        elif drone.name in preset_by_name:
            drone.latitude, drone.longitude = preset_by_name[drone.name]

        drones_reset += 1


    deleted_nfz = db.query(NoFlyZone).filter(NoFlyZone.name.like("NFZ Demo%")).delete(synchronize_session=False)

    db.commit()

    if deleted_nfz > 0:
        from backend.services.no_fly_zone_service import refresh_cache
        refresh_cache(db)


    from backend.services.weather_service import clear_scenario_overrides
    clear_scenario_overrides()

    ensure = ensure_minimum_drones(db, DEFAULT_MIN_FLEET)

    return {
        "closed_missions": len(open_missions),
        "demo_deliveries_cancelled": demo_cancelled,
        "deliveries_set_pending": deliveries_reset,
        "drones_reset": drones_reset,
        "fleet_ensure": ensure,
    }
