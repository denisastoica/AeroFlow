"""
Internal city model: logical grid for drone routing.
Each cell is a node connected to neighbors (8 directions).
A* algorithm (with Octile heuristic) finds the shortest path between two points.
"""
import math
import heapq
from typing import List, Tuple, Optional


def simplify_polyline_lat_lon(points: List[Tuple[float, float]], epsilon_deg: float = 0.0001) -> List[Tuple[float, float]]:
    """
    Simplifies a list of [lat, lon] points using the Douglas-Peucker algorithm.
    Used to reduce the number of points on very long routes without obstacles.
    """
    if len(points) <= 2:
        return points

    def point_line_dist_deg(p, p1, p2):
        """Point-line distance in degrees (flat approximation)."""
        if p1 == p2:
            return math.sqrt((p[0] - p1[0])**2 + (p[1] - p1[1])**2)
        
        y, x = p[0], p[1]
        y1, x1 = p1[0], p1[1]
        y2, x2 = p2[0], p2[1]
        
        num = abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1)
        den = math.sqrt((y2 - y1)**2 + (x2 - x1)**2)
        return num / den

    dmax = 0
    index = 0
    for i in range(1, len(points) - 1):
        d = point_line_dist_deg(points[i], points[0], points[-1])
        if d > dmax:
            index = i
            dmax = d

    if dmax > epsilon_deg:
        res1 = simplify_polyline_lat_lon(points[:index + 1], epsilon_deg)
        res2 = simplify_polyline_lat_lon(points[index:], epsilon_deg)
        return res1[:-1] + res2
    else:
        return [points[0], points[-1]]


def bresenham_line(r0: int, c0: int, r1: int, c1: int) -> List[Tuple[int, int]]:
    """Generates all cells intersected by a straight line between two cells."""
    points = []
    dr = abs(r1 - r0)
    dc = abs(c1 - c0)
    sr = 1 if r0 < r1 else -1
    sc = 1 if c0 < c1 else -1
    err = dr - dc

    while True:
        points.append((r0, c0))
        if r0 == r1 and c0 == c1:
            break
        e2 = 2 * err
        if e2 > -dc:
            err -= dc
            r0 += sr
        if e2 < dr:
            err += dr
            c0 += sc
    return points


def string_pulling(path_cells: List[Tuple[int, int]], blocked_cells: set) -> List[Tuple[int, int]]:
    """
    Applies the String Pulling algorithm to smooth the grid path.
    Optimized: searches backwards from the end of the path to instantly find the furthest visible point.
    """
    if len(path_cells) <= 2:
        return path_cells
        
    smooth_path = [path_cells[0]]
    curr_idx = 0
    n = len(path_cells)
    
    while curr_idx < n - 1:
        furthest_visible_idx = curr_idx + 1
        

        for i in range(n - 1, curr_idx, -1):
            r0, c0 = path_cells[curr_idx]
            r1, c1 = path_cells[i]
            
            line = bresenham_line(r0, c0, r1, c1)
            

            blocked = False
            for r, c in line:
                if (r, c) in blocked_cells:

                    if (r, c) == path_cells[0] or (r, c) == path_cells[-1]:
                        continue
                    blocked = True
                    break
            
            if not blocked:
                furthest_visible_idx = i
                break
                
        smooth_path.append(path_cells[furthest_visible_idx])
        curr_idx = furthest_visible_idx
        
    return smooth_path


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates distance in km between two geographic points (Haversine formula)."""
    R = 6371
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


class CityGrid:
    """
    2D logical grid representing the city area (e.g. Cluj-Napoca).
    Each cell has lat/lon coordinates and is connected to neighbors (8 directions).
    """

    def __init__(
        self,
        min_lat: float = 43.5,
        max_lat: float = 48.5,
        min_lon: float = 20.0,
        max_lon: float = 30.0,
        rows: int = 1000,
        cols: int = 2000,
    ):
        self.min_lat = min_lat
        self.max_lat = max_lat
        self.min_lon = min_lon
        self.max_lon = max_lon
        self.rows = rows
        self.cols = cols
        self.lat_step = (self.max_lat - self.min_lat) / (self.rows - 1) if self.rows > 1 else 0
        self.lon_step = (self.max_lon - self.min_lon) / (self.cols - 1) if self.cols > 1 else 0

    def _get_neighbors(self, r: int, c: int) -> List[Tuple[Tuple[int, int], float]]:
        """Calculates neighbors on the fly for grid A* pathfinding."""
        neighbors = []
        directions = [
            (-1, 0), (1, 0), (0, -1), (0, 1),
            (-1, -1), (-1, 1), (1, -1), (1, 1),
        ]
        

        lat_len_km = self.lat_step * 111.0
        mid_lat = (self.min_lat + self.max_lat) / 2
        lon_len_km = self.lon_step * 111.0 * math.cos(math.radians(mid_lat))
        
        for dr, dc in directions:
            nr, nc = r + dr, c + dc
            if 0 <= nr < self.rows and 0 <= nc < self.cols:

                dy = dr * lat_len_km
                dx = dc * lon_len_km
                cost = math.hypot(dx, dy)
                neighbors.append(((nr, nc), cost))
        return neighbors

    def _latlon_to_cell(self, lat: float, lon: float) -> Tuple[int, int]:
        """Converts lat/lon coordinates to cell index."""
        if lat < self.min_lat or lat > self.max_lat or lon < self.min_lon or lon > self.max_lon:

            lat = max(self.min_lat, min(self.max_lat, lat))
            lon = max(self.min_lon, min(self.max_lon, lon))
        r = int(round((lat - self.min_lat) / (self.max_lat - self.min_lat) * (self.rows - 1)))
        c = int(round((lon - self.min_lon) / (self.max_lon - self.min_lon) * (self.cols - 1)))
        r = max(0, min(self.rows - 1, r))
        c = max(0, min(self.cols - 1, c))
        return (r, c)

    def _cell_to_latlon(self, r: int, c: int) -> Tuple[float, float]:
        """Converts cell index to lat/lon coordinates (cell center)."""
        lat_step = (self.max_lat - self.min_lat) / (self.rows - 1) if self.rows > 1 else 0
        lon_step = (self.max_lon - self.min_lon) / (self.cols - 1) if self.cols > 1 else 0
        lat = self.min_lat + r * lat_step
        lon = self.min_lon + c * lon_step
        return (lat, lon)

    def a_star(
        self,
        start: Tuple[int, int],
        end: Tuple[int, int],
        blocked_cells: Optional[set] = None,
    ) -> Optional[List[Tuple[int, int]]]:
        """
        A* algorithm: finds the shortest path using an optimized Octile heuristic.
        """
        if blocked_cells is None:
            blocked_cells = set()


        lat_len_km = self.lat_step * 111.0
        mid_lat = (self.min_lat + self.max_lat) / 2
        lon_len_km = self.lon_step * 111.0 * math.cos(math.radians(mid_lat))

        def heuristic(cell: Tuple[int, int]) -> float:

            dx = abs(cell[1] - end[1]) * lon_len_km
            dy = abs(cell[0] - end[0]) * lat_len_km
            return max(dx, dy) + 0.414 * min(dx, dy)

        dist = {start: 0}
        prev: dict[Tuple[int, int], Optional[Tuple[int, int]]] = {start: None}

        pq: List[Tuple[float, Tuple[int, int]]] = [(heuristic(start), start)]
        visited = set()

        while pq:
            _, u = heapq.heappop(pq)
            
            if u in visited:
                continue
            visited.add(u)

            if u == end:
                break
            
            for v, cost in self._get_neighbors(u[0], u[1]):
                if v in visited:
                    continue
                    
                dr = v[0] - u[0]
                dc = v[1] - u[1]
                

                if abs(dr) + abs(dc) == 2:
                    c1 = (u[0] + dr, u[1])
                    c2 = (u[0], u[1] + dc)
                    if c1 in blocked_cells or c2 in blocked_cells:
                        continue
                        

                if v in blocked_cells and v != start and v != end:
                    continue
                    
                new_g_score = dist[u] + cost
                if new_g_score < dist.get(v, float("inf")):
                    dist[v] = new_g_score
                    prev[v] = u
                    f_score = new_g_score + heuristic(v)
                    heapq.heappush(pq, (f_score, v))

        if end not in prev:
            return None

        path = []
        curr = end
        while curr is not None:
            path.append(curr)
            curr = prev[curr]
        path.reverse()
        return path

    def find_route(
        self,
        start_lat: float,
        start_lon: float,
        end_lat: float,
        end_lon: float,
        blocked_cells: Optional[set] = None,
    ) -> List[Tuple[float, float]]:
        """
        Finds a route between two geographic points, avoiding blocked cells.
        Returns a list of [lat, lon] coordinates along the route.
        """
        start_cell = self._latlon_to_cell(start_lat, start_lon)
        end_cell = self._latlon_to_cell(end_lat, end_lon)

        path_cells = self.a_star(start_cell, end_cell, blocked_cells)
        if not path_cells:

            import logging
            logging.getLogger(__name__).warning(
                f"No grid path found from {start_lat, start_lon} to {end_lat, end_lon}"
            )
            return []


        path_cells = string_pulling(path_cells, blocked_cells if blocked_cells else set())


        if not path_cells:
            return []

        path_coords = [[start_lat, start_lon]]
        

        if len(path_cells) > 2:
            for r, c in path_cells[1:-1]:
                path_coords.append(list(self._cell_to_latlon(r, c)))
        

        if len(path_cells) >= 2:
            path_coords.append([end_lat, end_lon])
            
        coords = [tuple(p) for p in path_coords]


        if len(coords) > 2:
            coords = simplify_polyline_lat_lon(coords, epsilon_deg=0.00005)

        if not coords:
            coords = [(start_lat, start_lon), (end_lat, end_lon)]
        else:

            if len(coords) == 1:

                dist = haversine_distance(start_lat, start_lon, end_lat, end_lon)
                if dist > 1e-6:
                    coords = [(start_lat, start_lon), (end_lat, end_lon)]
                else:
                    coords = [(start_lat, start_lon), (end_lat + 0.00001, end_lon + 0.00001)]
            else:
                coords[0] = (start_lat, start_lon)
                coords[-1] = (end_lat, end_lon)

        return coords


city_grid = CityGrid(
    min_lat=43.5,
    max_lat=48.5,
    min_lon=20.0,
    max_lon=30.0,
    rows=1000,
    cols=2000,
)
