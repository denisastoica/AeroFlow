import json
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Any, List, Optional


VALID_DRONE_STATUSES = ["idle", "in_mission", "charging", "going_to_charging", "maintenance", "inactive"]


def _safe_parse_json_list(v: Any) -> Optional[List[Any]]:
    """Helper to ensure we always return a list or None for path fields."""
    if v is None:
        return None
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        v_stripped = v.strip()
        if not v_stripped or v_stripped.lower() == "null" or v_stripped == "":
            return None
        try:

            data = json.loads(v_stripped)
            if isinstance(data, list):
                return data
            return None
        except:

            return None

    return None


class DroneCreateRequest(BaseModel):
    """Create a drone by name only (position defaults to 0,0)."""
    name: str = Field(..., min_length=1, max_length=100)
    status: Optional[str] = None
    battery_health: Optional[float] = Field(None, ge=0, le=100)

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_DRONE_STATUSES:
            raise ValueError(
                f"Invalid status. Must be one of: {', '.join(VALID_DRONE_STATUSES)}"
            )
        return v


class DroneCreateByAddress(BaseModel):
    """Create a drone and geocode its initial position from a street address."""
    name: str = Field(..., min_length=1, max_length=100)
    address: str = Field(..., min_length=3)


class DroneStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in VALID_DRONE_STATUSES:
            raise ValueError(
                f"Invalid status. Must be one of: {', '.join(VALID_DRONE_STATUSES)}"
            )
        return v


class StartMissionRequest(BaseModel):
    """Manual mission start — server recalculates a safe route to the last point."""
    path: List[List[float]] = Field(..., min_length=2)


class DroneUpdateRequest(BaseModel):
    """Update drone properties."""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    status: Optional[str] = None
    battery: Optional[float] = Field(None, ge=0, le=100)
    battery_health: Optional[float] = Field(None, ge=0, le=100)
    motor_efficiency: Optional[float] = Field(None, ge=0, le=1)
    weight_kg: Optional[float] = Field(None, ge=0)

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_DRONE_STATUSES:
            raise ValueError(
                f"Invalid status. Must be one of: {', '.join(VALID_DRONE_STATUSES)}"
            )
        return v


class ActiveMissionSummary(BaseModel):
    """Compact mission info embedded inside drone responses."""
    id: int
    status: str
    progress_pct: float
    remaining_km: Optional[float] = None
    remaining_duration_h: Optional[float] = None


class ActiveDeliverySummary(BaseModel):
    """Compact delivery info embedded inside fleet-status per-drone entries."""
    id: int
    status: str
    priority: Optional[str] = "normal"
    package_type: Optional[str] = "standard"


class DroneResponse(BaseModel):
    """Standard drone response (POST /drones/, POST /drones/add_by_address)."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    status: str
    battery: float
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    battery_health: float = 100.0
    max_battery_wh: float = 500.0
    total_flight_km: float = 0.0
    total_charge_cycles: int = 0
    motor_efficiency: float = 0.92
    weight_kg: float = 3.5
    maintenance_source: Optional[str] = None
    route_path: Optional[List[Any]] = None
    planned_route_path: Optional[List[Any]] = None
    route_index: Optional[int] = 0
    dest_latitude: Optional[float] = None
    dest_longitude: Optional[float] = None

    @field_validator("route_path", "planned_route_path", mode="before")
    @classmethod
    def parse_json_string(cls, v: Any) -> Any:
        return _safe_parse_json_list(v)


class DroneDetailResponse(BaseModel):
    """Extended drone response for GET /drones/ and GET /drones/{id}.

    Includes computed fields (estimated_range_km, battery_status) and the
    active mission summary when one exists.
    """
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    status: str
    battery: float
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    battery_health: float
    max_battery_wh: float
    total_flight_km: float
    total_charge_cycles: int
    estimated_range_km: float
    battery_status: Any
    motor_efficiency: float
    weight_kg: float
    maintenance_source: Optional[str] = None
    route_path: Optional[List[Any]] = None
    planned_route_path: Optional[List[Any]] = None
    route_index: Optional[int] = None
    dest_latitude: Optional[float] = None
    dest_longitude: Optional[float] = None

    mission_id: Optional[int] = None
    mission_status: Optional[str] = None
    mission_progress_pct: Optional[float] = None
    mission_remaining_km: Optional[float] = None
    mission_remaining_duration_h: Optional[float] = None

    @field_validator("route_path", "planned_route_path", mode="before")
    @classmethod
    def parse_json_string(cls, v: Any) -> Any:
        return _safe_parse_json_list(v)


class FleetDroneInfo(BaseModel):
    """Per-drone entry inside FleetStatusResponse."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    status: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    battery: float
    battery_health: float
    estimated_range_km: float
    total_flight_km: float
    total_charge_cycles: int
    motor_efficiency: float
    weight_kg: float
    maintenance_source: Optional[str] = None
    planned_route_path: Optional[List[Any]] = None
    nearest_station_km: Optional[float] = None
    mission: Optional[ActiveMissionSummary] = None
    delivery: Optional[ActiveDeliverySummary] = None

    @field_validator("planned_route_path", mode="before")
    @classmethod
    def parse_json_string(cls, v: Any) -> Any:
        return _safe_parse_json_list(v)


class FleetSummary(BaseModel):
    total: int
    by_status: dict
    avg_battery: float
    avg_health: float
    pending_deliveries: int


class FleetStatusResponse(BaseModel):
    """Response for GET /drones/fleet-status."""
    drones: List[FleetDroneInfo]
    summary: FleetSummary
