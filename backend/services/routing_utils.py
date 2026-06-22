from math import ceil
from backend.services.grid import city_grid, haversine_distance

def direct_segment_is_clear(start_lat, start_lon, end_lat, end_lon, blocked_cells, samples=None):
    """Checks if a direct line between two points is clear of blocked cells with adaptive sampling."""
    dist_km = haversine_distance(
        float(start_lat), float(start_lon),
        float(end_lat), float(end_lon)
    )
    
    if samples is None:

        samples = max(80, int(ceil(dist_km * 2)))

    start_cell = city_grid._latlon_to_cell(start_lat, start_lon)
    end_cell = city_grid._latlon_to_cell(end_lat, end_lon)

    for i in range(samples + 1):
        t = i / samples
        lat = float(start_lat) + (float(end_lat) - float(start_lat)) * t
        lon = float(start_lon) + (float(end_lon) - float(start_lon)) * t
        cell = city_grid._latlon_to_cell(lat, lon)
        

        if cell in blocked_cells and cell != start_cell and cell != end_cell:
            return False
    return True


def plan_route_leg(start_lat, start_lon, end_lat, end_lon, blocked_cells):
    """Plans a leg between two points, using direct path if clear, else A* grid."""
    if direct_segment_is_clear(
        start_lat,
        start_lon,
        end_lat,
        end_lon,
        blocked_cells,
    ):
        return [
            [float(start_lat), float(start_lon)],
            [float(end_lat), float(end_lon)],
        ]
    return city_grid.find_route(
        float(start_lat),
        float(start_lon),
        float(end_lat),
        float(end_lon),
        blocked_cells=blocked_cells,
    )
