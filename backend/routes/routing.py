"""
API for routing: calculates the path between two points using the city grid and A*.
Automatically avoids restricted flight areas (no-fly zones).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List
import logging

from backend.services.grid import city_grid
from backend.services.no_fly_zone_service import get_blocked_cells
from backend.services.routing_utils import plan_route_leg

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/route", tags=["Routing"])


class RouteRequest(BaseModel):
    start_lat: float = Field(..., ge=-90, le=90)
    start_lon: float = Field(..., ge=-180, le=180)
    end_lat: float = Field(..., ge=-90, le=90)
    end_lon: float = Field(..., ge=-180, le=180)


class RouteResponse(BaseModel):
    path: List[List[float]]
    distance_km: float


def _path_distance(path: List[tuple]) -> float:
    """Calculates the total distance of the route in km."""
    from backend.services.grid import haversine_distance
    total = 0
    for i in range(len(path) - 1):
        total += haversine_distance(
            path[i][0], path[i][1],
            path[i + 1][0], path[i + 1][1],
        )
    return round(total, 2)


@router.post("/", response_model=RouteResponse)
def compute_route(request: RouteRequest):
    """
    Calculates the optimal route between two points using the city grid and A*.
    Automatically avoids restricted flight areas (no-fly zones).
    Returns a list of coordinates [lat, lon] and the distance in km.
    """
    try:

        blocked = get_blocked_cells(city_grid)

        path = plan_route_leg(
            request.start_lat,
            request.start_lon,
            request.end_lat,
            request.end_lon,
            blocked,
        )
        if len(path) < 2:
            raise HTTPException(
                status_code=422,
                detail="No safe route exists between points (possibly blocked by restricted zones or outside the grid).",
            )
        distance = _path_distance(path)
        return RouteResponse(
            path=[[p[0], p[1]] for p in path],
            distance_km=distance,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Route calculation failed")
        raise HTTPException(
            status_code=500,
            detail="Internal error calculating route. Please try again."
        )
