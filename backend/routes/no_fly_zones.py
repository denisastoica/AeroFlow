"""
API endpoints for managing restricted flight areas (no-fly zones).
CRUD + point/route checks.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from backend.database import get_db
from backend.schemas.no_fly_zone import (
    NoFlyZoneCreate,
    NoFlyZoneUpdate,
    NoFlyZoneResponse,
    NoFlyCheckResponse,
    RouteNoFlyCheckResponse,
)
from backend.services import no_fly_zone_service
from backend.services.auth_dependencies import require_role

router = APIRouter(prefix="/no-fly-zones", tags=["Restricted Zones"])


@router.get("/", response_model=List[NoFlyZoneResponse])
def list_zones(active_only: bool = True, db: Session = Depends(get_db)):
    """Lists all restricted zones (defaults to active only)."""
    if active_only:
        zones = no_fly_zone_service.get_active_zones_db(db)
    else:
        from backend.models.no_fly_zone import NoFlyZone
        zones = db.query(NoFlyZone).all()
    return zones


@router.post("/", response_model=NoFlyZoneResponse, status_code=201)
def create_zone(
    data: NoFlyZoneCreate,
    payload: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    """Creates a new restricted zone."""
    zone = no_fly_zone_service.create_zone(
        db,
        name=data.name,
        center_lat=data.center_lat,
        center_lon=data.center_lon,
        radius_km=data.radius_km,
        reason=data.reason,
        zone_type=data.zone_type,
        expires_at=data.expires_at,
    )
    return zone


@router.get("/check", response_model=NoFlyCheckResponse)
def check_point(lat: float, lon: float):
    """Checks if a point is within a restricted zone."""
    is_blocked, zones = no_fly_zone_service.is_point_in_no_fly_zone(lat, lon)
    return NoFlyCheckResponse(
        is_in_no_fly_zone=is_blocked,
        zones=[NoFlyZoneResponse(**z) for z in zones],
    )


@router.post("/check-route", response_model=RouteNoFlyCheckResponse)
def check_route(path: List[List[float]]):
    """Checks if a route crosses restricted zones."""
    if len(path) < 2:
        raise HTTPException(status_code=400, detail="Path must have at least 2 points")
    clear, violated, blocked_count = no_fly_zone_service.check_route_no_fly(path)
    return RouteNoFlyCheckResponse(
        route_clear=clear,
        violated_zones=[NoFlyZoneResponse(**z) for z in violated],
        blocked_points_count=blocked_count,
    )


@router.put("/{zone_id}", response_model=NoFlyZoneResponse)
def update_zone(
    zone_id: int,
    data: NoFlyZoneUpdate,
    payload: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    """Updates a restricted zone."""
    updates = data.model_dump(exclude_unset=True)
    zone = no_fly_zone_service.update_zone(db, zone_id, **updates)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    return zone


@router.delete("/{zone_id}", status_code=204)
def delete_zone(
    zone_id: int,
    payload: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    """Deletes a restricted zone."""
    ok = no_fly_zone_service.delete_zone(db, zone_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Zone not found")
