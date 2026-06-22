from pydantic import BaseModel, ConfigDict, field_validator
from typing import Optional
from datetime import datetime

class MissionBase(BaseModel):
    drone_id: int
    delivery_id: int
    estimated_distance_km: Optional[float] = None
    estimated_duration_h: Optional[float] = None


class MissionCreate(MissionBase):
    pass


class MissionResponse(MissionBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    start_time: datetime
    end_time: Optional[datetime] = None

    @field_validator('start_time', 'end_time', mode='after')
    @classmethod
    def ensure_utc(cls, v: Optional[datetime]) -> Optional[datetime]:
        if v and v.tzinfo is None:
            from datetime import timezone
            return v.replace(tzinfo=timezone.utc)
        return v

    actual_duration_h: Optional[float] = None
    total_distance_km: Optional[float] = None
    progress_pct: Optional[float] = None
    remaining_km: Optional[float] = None
    remaining_duration_h: Optional[float] = None
    remaining_km_to_pickup: Optional[float] = None
    remaining_km_to_destination: Optional[float] = None
    status: Optional[str] = None
    pickup_waypoint_index: Optional[int] = None
    planned_route_path: Optional[list] = None

    drone_lat: Optional[float] = None
    drone_lon: Optional[float] = None
    drone_battery: Optional[float] = None
    drone_speed: Optional[float] = None
    route_path: Optional[list] = None
    route_index: Optional[int] = None

    pickup_lat: Optional[float] = None
    pickup_lon: Optional[float] = None
    dest_lat: Optional[float] = None
    dest_lon: Optional[float] = None


class PaginatedMissionsResponse(BaseModel):
    """Răspuns paginat pentru misiuni."""
    items: list[MissionResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_prev: bool
