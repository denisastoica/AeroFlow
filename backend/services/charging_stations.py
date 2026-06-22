"""
Fixed charging stations for drones.
Drones can only charge at these points, not anywhere else.
"""
from typing import List, Tuple, Optional

from backend.services.grid import haversine_distance, city_grid
from backend.services.no_fly_zone_service import get_blocked_cells
from backend.services.geo_locations import CITY_COORDS


MAX_AUTONOMY_KM = 120


INITIAL_STATIONS = [

    (*CITY_COORDS["Cluj-Napoca"], "Cluj-Napoca Center"),
    (*CITY_COORDS["Alba Iulia"], "Alba Iulia"),
    (*CITY_COORDS["Brasov"], "Brasov Center"),
    (*CITY_COORDS["Fagaras"], "Fagaras"),
    (*CITY_COORDS["Sibiu"], "Sibiu Center"),
    (*CITY_COORDS["Hunedoara"], "Hunedoara"),
    (*CITY_COORDS["Targu Mures"], "Targu Mures"),
    (46.7700, 25.7900, "Bistrita"),
    (*CITY_COORDS["Baia Mare"], "Baia Mare"),

    (46.3600, 25.8000, "Miercurea Ciuc"),
    (46.5700, 26.9100, "Bacau"),

    (45.7489, 21.2087, "Timisoara Center"),
    (46.1866, 21.3123, "Arad Center"),
    (46.8000, 21.6500, "Salonta"),
    (47.0465, 21.9189, "Oradea Center"),
    (46.8850, 22.8600, "Huedin"),

    (47.1585, 27.5931, "Iasi Center"),
    (46.9300, 26.3700, "Piatra Neamt"),
    (47.6400, 26.2553, "Suceava Center"),
    (46.6400, 27.7300, "Vaslui"),

    (44.4268, 26.1025, "Bucharest North"),
    (*CITY_COORDS["Craiova"], "Craiova Center"),
    (*CITY_COORDS["Targu Jiu"], "Targu Jiu"),
    (44.9400, 26.0200, "Ploiesti"),
    (44.1950, 25.9650, "Giurgiu"),

    (45.1267, 25.7444, "Campina"),
    (45.1500, 26.8300, "Buzau"),
    (45.7000, 27.1900, "Focsani"),
    (46.2456, 26.7768, "Onesti"),

    (44.5600, 27.3700, "Slobozia"),
    (44.3700, 27.8300, "Fetesti"),
    (44.1598, 28.6348, "Constanta"),
    (45.2667, 27.9833, "Galati"),
]

CHARGING_STATIONS: List[Tuple[float, float, str]] = []


import threading
from sqlalchemy.orm import Session
from backend.models.charging_station import ChargingStation

_stations_lock = threading.Lock()

def seed_and_load_stations(db: Session):
    """Seeds from INITIAL_STATIONS if DB is empty, then loads to memory cache."""
    global CHARGING_STATIONS, _station_adj_cache, _station_count_at_build
    count = db.query(ChargingStation).count()
    if count == 0:
        for st in INITIAL_STATIONS:
            db.add(ChargingStation(latitude=st[0], longitude=st[1], name=st[2], active=True))
        db.commit()
    
    with _stations_lock:
        db_stations = db.query(ChargingStation).filter(ChargingStation.active == True).all()
        CHARGING_STATIONS = [(s.latitude, s.longitude, s.name) for s in db_stations]
        _station_adj_cache = None
        _station_count_at_build = 0

def get_nearest_station(lat: float, lon: float) -> Optional[Tuple[float, float, str]]:
    """Finds the nearest charging station."""
    if not CHARGING_STATIONS:
        return None

    def dist_km(s):
        return haversine_distance(lat, lon, s[0], s[1])

    return min(CHARGING_STATIONS, key=dist_km)


from backend.services.routing_utils import plan_route_leg

def _route_distance_km(start_lat: float, start_lon: float, end_lat: float, end_lon: float) -> float:
    """Calculates routable distance (km) on the grid, avoiding NFZ."""
    blocked = get_blocked_cells(city_grid)
    route = plan_route_leg(
        start_lat, start_lon, end_lat, end_lon, blocked_cells=blocked
    )
    if len(route) < 2:
        return float("inf")
    total = 0.0
    for i in range(len(route) - 1):
        total += haversine_distance(route[i][0], route[i][1], route[i + 1][0], route[i + 1][1])
    return total


def get_optimal_station(lat: float, lon: float, dest_lat: Optional[float], dest_lon: Optional[float]) -> Optional[Tuple[float, float, str]]:
    """
    Chooses the optimal station to continue the mission.

    Strategy: for each station, calculate routable distance from current position to
    station and from station to destination. Chooses the station that minimizes detour
    compared to direct route (d1 + d2 - baseline).

    If destination is not available, falls back to nearest station.
    """
    if not CHARGING_STATIONS:
        return None

    if dest_lat is None or dest_lon is None:
        return get_nearest_station(lat, lon)

    baseline = _route_distance_km(lat, lon, dest_lat, dest_lon)
    best = None
    best_extra = float("inf")

    for s in CHARGING_STATIONS:
        to_station = _route_distance_km(lat, lon, s[0], s[1])
        station_to_dest = _route_distance_km(s[0], s[1], dest_lat, dest_lon)
        extra = to_station + station_to_dest - baseline
        if extra < best_extra:
            best_extra = extra
            best = s

    return best


_GRID_OVERHEAD = 1.01


_station_adj_cache: Optional[List[List[int]]] = None
_station_count_at_build: int = 0


def _haversine_reachable(lat1: float, lon1: float, lat2: float, lon2: float) -> bool:
    """Quick feasibility check: Haversine * overhead ≤ maximum autonomy."""
    return haversine_distance(lat1, lon1, lat2, lon2) * _GRID_OVERHEAD <= MAX_AUTONOMY_KM


def _get_station_adjacency() -> List[List[int]]:
    """Adjacency matrix between stations, calculated lazy and cached."""
    global _station_adj_cache, _station_count_at_build
    n = len(CHARGING_STATIONS)
    if _station_adj_cache is not None and _station_count_at_build == n:
        return _station_adj_cache

    n = len(CHARGING_STATIONS)
    adj: List[List[int]] = [[] for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j and _haversine_reachable(
                CHARGING_STATIONS[i][0], CHARGING_STATIONS[i][1],
                CHARGING_STATIONS[j][0], CHARGING_STATIONS[j][1],
            ):
                adj[i].append(j)
    _station_adj_cache = adj
    _station_count_at_build = n
    return adj


def find_station_chain(
    start_lat: float,
    start_lon: float,
    dest_lat: float,
    dest_lon: float,
    first_leg_km: float | None = None,
    full_leg_km: float | None = None,
) -> Optional[List[Tuple[float, float, str]]]:
    """
    Finds a chain of stations (ordered list) so the drone can reach the destination
    from start by charging at the stations in the chain.

    - first_leg_km: real autonomy from current position to the first station/destination.
    - full_leg_km: autonomy after full charge, used between subsequent stations.

    Returns:
    - [] (empty list) if destination is directly reachable from start.
    - list of stations [(lat, lon, name), ...] in order of visit if path exists.
    - None if no path exists through station network.

    Algorithm: Dijkstra with FORWARD-PROGRESS CONSTRAINT.
    Each hop station must be strictly closer to the destination than the previous
    position (i.e. dist_to_dest decreases). This prevents oscillation loops like
    Brasov <-> Miercurea-Ciuc when the real route goes toward Resita in the
    opposite direction.
    """
    import heapq

    if not CHARGING_STATIONS:
        return None

    first_leg_km = first_leg_km or MAX_AUTONOMY_KM
    full_leg_km = full_leg_km or MAX_AUTONOMY_KM

    def reachable_with_limit(lat1, lon1, lat2, lon2, limit_km):
        return haversine_distance(lat1, lon1, lat2, lon2) * _GRID_OVERHEAD <= limit_km


    if reachable_with_limit(start_lat, start_lon, dest_lat, dest_lon, first_leg_km):
        return []

    n = len(CHARGING_STATIONS)
    dist_start_to_dest = haversine_distance(start_lat, start_lon, dest_lat, dest_lon)


    heap = []
    visited: set = set()


    for i in range(n):
        s = CHARGING_STATIONS[i]
        d_to_station = haversine_distance(start_lat, start_lon, s[0], s[1]) * _GRID_OVERHEAD
        if d_to_station > first_leg_km:
            continue

        d_station_to_dest = haversine_distance(s[0], s[1], dest_lat, dest_lon)


        if d_station_to_dest < dist_start_to_dest * 1.05:
            heapq.heappush(heap, (d_to_station, i, (i,)))


    while heap:
        total_dist, last_idx, path_tuple = heapq.heappop(heap)
        last = CHARGING_STATIONS[last_idx]

        if last_idx in visited:
            continue
        visited.add(last_idx)

        dist_last_to_dest = haversine_distance(last[0], last[1], dest_lat, dest_lon)


        if reachable_with_limit(last[0], last[1], dest_lat, dest_lon, full_leg_km):
            return [CHARGING_STATIONS[i] for i in path_tuple]


        for j in range(n):
            if j in visited:
                continue

            nb = CHARGING_STATIONS[j]
            d_to_nb = haversine_distance(last[0], last[1], nb[0], nb[1]) * _GRID_OVERHEAD


            if d_to_nb > full_leg_km:
                continue

            d_nb_to_dest = haversine_distance(nb[0], nb[1], dest_lat, dest_lon)


            if d_nb_to_dest >= dist_last_to_dest * 1.05:
                continue

            heapq.heappush(heap, (total_dist + d_to_nb, j, path_tuple + (j,)))


    return None


def get_forward_station(
    current_lat: float,
    current_lon: float,
    dest_lat: float,
    dest_lon: float,
    range_km: float,
    exclude_station: Optional[Tuple[float, float, str]] = None,
    require_progress: bool = False,
) -> Optional[Tuple[float, float, str]]:
    """
    Selects the best next charging station that:
    1. Is reachable with current battery (distance <= range_km).
    2. Makes FORWARD PROGRESS toward the destination (is closer to dest than current pos).
    3. Minimizes total path distance (current -> station + station -> dest).

    Used by the simulator to pick the next charging hop without creating loops.
    If no forward-progress station exists within range, returns the nearest reachable one
    (emergency fallback to avoid battery-dead crash).
    """
    if not CHARGING_STATIONS:
        return None

    dist_current_to_dest = haversine_distance(current_lat, current_lon, dest_lat, dest_lon)

    best: Optional[Tuple[float, float, str]] = None
    best_score = float("inf")
    best_fallback: Optional[Tuple[float, float, str]] = None
    best_fallback_dist = float("inf")

    for s in CHARGING_STATIONS:

        if exclude_station is not None:
            if haversine_distance(s[0], s[1], exclude_station[0], exclude_station[1]) < 0.5:
                continue

        d_to_station = haversine_distance(current_lat, current_lon, s[0], s[1]) * _GRID_OVERHEAD
        if d_to_station > range_km:
            continue

        d_station_to_dest = haversine_distance(s[0], s[1], dest_lat, dest_lon)


        makes_progress = d_station_to_dest < dist_current_to_dest * 1.05

        if makes_progress:

            score = d_to_station + d_station_to_dest
            if score < best_score:
                best_score = score
                best = s
        else:

            if d_to_station < best_fallback_dist:
                best_fallback_dist = d_to_station
                best_fallback = s

    return best if best is not None else (None if require_progress else best_fallback)


def distance_to_nearest_station_km(lat: float, lon: float) -> Optional[float]:
    """Distance in km to the nearest station."""
    station = get_nearest_station(lat, lon)
    if not station:
        return None
    return round(haversine_distance(lat, lon, station[0], station[1]), 2)


def get_all_stations() -> List[dict]:
    """Returns all stations for API."""
    return [
        {"lat": s[0], "lon": s[1], "name": s[2]}
        for s in CHARGING_STATIONS
    ]
