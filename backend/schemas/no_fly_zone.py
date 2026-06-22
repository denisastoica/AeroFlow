from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional
from datetime import datetime

VALID_ZONE_TYPES = ["permanent", "temporary", "emergency"]


class NoFlyZoneCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    center_lat: float = Field(..., ge=-90, le=90)
    center_lon: float = Field(..., ge=-180, le=180)
    radius_km: float = Field(default=5.0, gt=0, le=100)
    reason: Optional[str] = None
    zone_type: str = "permanent"
    expires_at: Optional[datetime] = None

    @field_validator('zone_type')
    @classmethod
    def validate_zone_type(cls, v: str) -> str:
        if v not in VALID_ZONE_TYPES:
            raise ValueError(f'Invalid zone type. Must be one of: {", ".join(VALID_ZONE_TYPES)}')
        return v


class NoFlyZoneUpdate(BaseModel):
    name: Optional[str] = None
    center_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    center_lon: Optional[float] = Field(default=None, ge=-180, le=180)
    radius_km: Optional[float] = Field(default=None, gt=0, le=100)
    reason: Optional[str] = None
    zone_type: Optional[str] = None
    is_active: Optional[bool] = None
    expires_at: Optional[datetime] = None

    @field_validator('zone_type')
    @classmethod
    def validate_zone_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_ZONE_TYPES:
            raise ValueError(f'Invalid zone type. Must be one of: {", ".join(VALID_ZONE_TYPES)}')
        return v


class NoFlyZoneResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    center_lat: float
    center_lon: float
    radius_km: float
    reason: Optional[str]
    zone_type: str
    is_active: bool
    created_at: Optional[datetime]
    expires_at: Optional[datetime]


class NoFlyCheckResponse(BaseModel):
    is_in_no_fly_zone: bool
    zones: list[NoFlyZoneResponse] = []


class RouteNoFlyCheckResponse(BaseModel):
    route_clear: bool
    violated_zones: list[NoFlyZoneResponse] = []
    blocked_points_count: int = 0
