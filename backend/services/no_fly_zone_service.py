"""
Service for managing restricted flight areas (no-fly zones).
Checks if a point or route intersects a restricted zone.
Maintains an in-memory cache for performance.
"""
import math
import threading
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from backend.models.no_fly_zone import NoFlyZone
from backend.services.grid import haversine_distance


_cache_lock = threading.Lock()
_zones_cache: list = []
_blocked_cells_cache = None


def _zone_to_dict(zone: NoFlyZone) -> dict:
    return {
        "id": zone.id,
        "name": zone.name,
        "center_lat": zone.center_lat,
        "center_lon": zone.center_lon,
        "radius_km": zone.radius_km,
        "reason": zone.reason,
        "zone_type": zone.zone_type,
        "is_active": zone.is_active,
        "created_at": zone.created_at,
        "expires_at": zone.expires_at,
    }


def refresh_cache(db: Session) -> None:
    """Reloads active zones from DB into cache."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    zones = db.query(NoFlyZone).filter(NoFlyZone.is_active == True).all()
    active = []
    for z in zones:

        if z.expires_at and z.expires_at < now:
            z.is_active = False
            db.commit()
            continue
        active.append(_zone_to_dict(z))
    with _cache_lock:
        global _zones_cache, _blocked_cells_cache
        _zones_cache = active
        _blocked_cells_cache = None


def get_active_zones() -> List[dict]:
    """Returns active zones from cache."""
    with _cache_lock:
        return list(_zones_cache)


def get_active_zones_db(db: Session) -> List[NoFlyZone]:
    """Returns active zones from DB."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    zones = db.query(NoFlyZone).filter(NoFlyZone.is_active == True).all()
    return [z for z in zones if not z.expires_at or z.expires_at >= now]


def create_zone(db: Session, **kwargs) -> NoFlyZone:
    zone = NoFlyZone(**kwargs)
    db.add(zone)
    db.commit()
    db.refresh(zone)
    refresh_cache(db)
    return zone


def update_zone(db: Session, zone_id: int, **kwargs) -> Optional[NoFlyZone]:
    zone = db.query(NoFlyZone).filter(NoFlyZone.id == zone_id).first()
    if not zone:
        return None
    for k, v in kwargs.items():
        if v is not None:
            setattr(zone, k, v)
    db.commit()
    db.refresh(zone)
    refresh_cache(db)
    return zone


def delete_zone(db: Session, zone_id: int) -> bool:
    zone = db.query(NoFlyZone).filter(NoFlyZone.id == zone_id).first()
    if not zone:
        return False
    db.delete(zone)
    db.commit()
    refresh_cache(db)
    return True


def is_point_in_no_fly_zone(lat: float, lon: float) -> Tuple[bool, List[dict]]:
    """
    Checks if a point is within a restricted zone.
    Returns (True/False, list of violated zones).
    """
    zones = get_active_zones()
    violated = []
    for z in zones:
        dist = haversine_distance(lat, lon, z["center_lat"], z["center_lon"])
        if dist <= z["radius_km"]:
            violated.append(z)
    return (len(violated) > 0, violated)


def check_route_no_fly(path: List[List[float]]) -> Tuple[bool, List[dict], int]:
    """
    Checks if a route (list of [lat, lon]) crosses restricted zones.
    Returns (route_clear, violated_zones, blocked_points_count).
    """
    zones = get_active_zones()
    if not zones or not path:
        return (True, [], 0)

    violated_ids = set()
    violated_zones = []
    blocked_count = 0

    for point in path:
        lat, lon = point[0], point[1]
        for z in zones:
            dist = haversine_distance(lat, lon, z["center_lat"], z["center_lon"])
            if dist <= z["radius_km"]:
                blocked_count += 1
                if z["id"] not in violated_ids:
                    violated_ids.add(z["id"])
                    violated_zones.append(z)
                break

    return (blocked_count == 0, violated_zones, blocked_count)


def get_blocked_cells(grid) -> set:
    """
    Calculates the set of grid cells (r, c) located in restricted zones.
    Used by A* pathfinding to avoid these cells.
    Maintains an internal cache to avoid redundant calculations.
    """
    global _blocked_cells_cache
    
    with _cache_lock:
        if _blocked_cells_cache is not None:
            return _blocked_cells_cache

    zones = get_active_zones()
    if not zones:
        return set()

    blocked = set()
    for z in zones:


        radius_km = z["radius_km"]
        lat_margin = radius_km / 110.0
        lon_margin = radius_km / (110.0 * math.cos(math.radians(z["center_lat"])))
        
        r_min, c_min = grid._latlon_to_cell(z["center_lat"] - lat_margin, z["center_lon"] - lon_margin)
        r_max, c_max = grid._latlon_to_cell(z["center_lat"] + lat_margin, z["center_lon"] + lon_margin)
        

        for r in range(r_min, r_max + 1):
            for c in range(c_min, c_max + 1):
                lat, lon = grid._cell_to_latlon(r, c)
                dist = haversine_distance(lat, lon, z["center_lat"], z["center_lon"])

                if dist <= (radius_km + 0.35):
                    blocked.add((r, c))
    
    with _cache_lock:
        _blocked_cells_cache = blocked
        
    return blocked


DEFAULT_ZONES = [

    {
        "name": "Henri Coanda Airport (Otopeni)",
        "center_lat": 44.5711,
        "center_lon": 26.0850,
        "radius_km": 5.0,
        "reason": "International Airport — Restricted CTR airspace",
        "zone_type": "permanent",
    },
    {
        "name": "Avram Iancu Airport Cluj",
        "center_lat": 46.7852,
        "center_lon": 23.6862,
        "radius_km": 2.0,
        "reason": "International Airport — Restricted airspace",
        "zone_type": "permanent",
    },
    {
        "name": "Traian Vuia Airport Timisoara",
        "center_lat": 45.8099,
        "center_lon": 21.3379,
        "radius_km": 4.0,
        "reason": "International Airport — Restricted airspace",
        "zone_type": "permanent",
    },
    {
        "name": "Iasi Airport",
        "center_lat": 47.1785,
        "center_lon": 27.6206,
        "radius_km": 3.0,
        "reason": "International Airport — Restricted airspace",
        "zone_type": "permanent",
    },
    {
        "name": "Mihail Kogalniceanu Airport Constanta",
        "center_lat": 44.3622,
        "center_lon": 28.4883,
        "radius_km": 4.0,
        "reason": "Military & Civil Airport — NATO restricted CTR",
        "zone_type": "permanent",
    },
    {
        "name": "Sibiu Airport",
        "center_lat": 45.7856,
        "center_lon": 24.0913,
        "radius_km": 3.0,
        "reason": "Airport — Restricted airspace",
        "zone_type": "permanent",
    },
    {
        "name": "Aurel Vlaicu Airport Bucharest Baneasa",
        "center_lat": 44.5032,
        "center_lon": 26.1022,
        "radius_km": 3.0,
        "reason": "Airport — Official and VIP flights",
        "zone_type": "permanent",
    },

    {
        "name": "71st Air Base Campia Turzii",
        "center_lat": 46.5028,
        "center_lon": 23.8869,
        "radius_km": 4.0,
        "reason": "Military air base — NATO Air Policing operations",
        "zone_type": "permanent",
    },
    {
        "name": "Deveselu Military Base (Aegis Ashore)",
        "center_lat": 43.7614,
        "center_lon": 24.3375,
        "radius_km": 5.0,
        "reason": "NATO Missile Defense Base — High security zone",
        "zone_type": "permanent",
    },
    {
        "name": "57th Air Base Mihail Kogalniceanu",
        "center_lat": 44.3500,
        "center_lon": 28.4400,
        "radius_km": 3.0,
        "reason": "NATO Air Base — Allied military operations",
        "zone_type": "permanent",
    },
    {
        "name": "90th Airlift Base Otopeni",
        "center_lat": 44.5600,
        "center_lon": 26.0600,
        "radius_km": 4.0,
        "reason": "Military airlift base",
        "zone_type": "permanent",
    },
    {
        "name": "72nd Air Management Center Balotesti",
        "center_lat": 44.6500,
        "center_lon": 26.1000,
        "radius_km": 3.0,
        "reason": "Military radar command center",
        "zone_type": "permanent",
    },

    {
        "name": "Cernavoda Nuclear Power Plant",
        "center_lat": 44.3208,
        "center_lon": 28.0578,
        "radius_km": 5.0,
        "reason": "Nuclear power plant — Air exclusion zone",
        "zone_type": "permanent",
    },

    {
        "name": "Cotroceni Palace (Presidency)",
        "center_lat": 44.4358,
        "center_lon": 26.0625,
        "radius_km": 1.5,
        "reason": "Presidential residence — Security zone",
        "zone_type": "permanent",
    },
    {
        "name": "Palace of Parliament",
        "center_lat": 44.4275,
        "center_lon": 26.0877,
        "radius_km": 1.0,
        "reason": "Parliament headquarters — Security zone",
        "zone_type": "permanent",
    },
]


def seed_default_zones(db: Session) -> None:
    """Creates default zones if none exist."""
    existing = db.query(NoFlyZone).count()
    if existing > 0:
        return
    print("[Seed] Creating default restricted zones...")
    for z in DEFAULT_ZONES:
        zone = NoFlyZone(**z, is_active=True)
        db.add(zone)
    db.commit()
    print(f"[Seed] {len(DEFAULT_ZONES)} restricted zones created.")
    refresh_cache(db)
