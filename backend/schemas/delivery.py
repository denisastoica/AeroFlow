from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional
from datetime import datetime


VALID_PRIORITIES = ["normal", "urgent", "emergency"]
VALID_PACKAGE_TYPES = ["standard", "medical", "fragile", "food"]


class DeliveryEstimateRequest(BaseModel):
    pickup_lat: float = Field(..., ge=-90, le=90)
    pickup_lon: float = Field(..., ge=-180, le=180)
    dest_lat: float = Field(..., ge=-90, le=90)
    dest_lon: float = Field(..., ge=-180, le=180)
    weight_kg: float = Field(default=1.0, gt=0, le=3)
    priority: str = "normal"

class DeliveryEstimateResponse(BaseModel):
    distance_km: float
    effective_speed_kmh: float
    estimated_duration_h: float
    needs_charging: bool
    charging_stops: int
    is_feasible: bool
    max_feasible_km: float

class DeliveryCreate(BaseModel):
    pickup_lat: float = Field(..., ge=-90, le=90)
    pickup_lon: float = Field(..., ge=-180, le=180)
    dest_lat: float = Field(..., ge=-90, le=90)
    dest_lon: float = Field(..., ge=-180, le=180)
    pickup_address: Optional[str] = None
    dest_address: Optional[str] = None
    priority: str = "normal"
    package_type: str = "standard"
    notes: Optional[str] = None
    weight_kg: float = Field(default=1.0, gt=0, le=3)

    @field_validator('priority')
    @classmethod
    def validate_priority(cls, v: str) -> str:
        if v not in VALID_PRIORITIES:
            raise ValueError(f'Invalid priority. Must be one of: {", ".join(VALID_PRIORITIES)}')
        return v

    @field_validator('package_type')
    @classmethod
    def validate_package_type(cls, v: str) -> str:
        if v not in VALID_PACKAGE_TYPES:
            raise ValueError(f'Invalid package type. Must be one of: {", ".join(VALID_PACKAGE_TYPES)}')
        return v


class DeliveryUpdate(BaseModel):
    status: Optional[str] = None
    drone_id: Optional[int] = None
    completed_at: Optional[datetime] = None


class DeliveryStatusUpdateRequest(BaseModel):
    new_status: Optional[str] = None
    status: Optional[str] = None


class TimelineStep(BaseModel):
    """A main step in the delivery timeline."""
    step: str
    label: str
    timestamp: Optional[datetime]
    completed: bool
    active: bool
    details: Optional[str] = None


class TimelineEvent(BaseModel):
    """Secondary event (charge, weather, etc.) from the raw log."""
    event_type: str
    label: str
    timestamp: datetime
    details: Optional[str] = None


class DeliveryTimeline(BaseModel):
    """Complete timeline of a delivery."""
    delivery_id: int
    current_status: str
    steps: list[TimelineStep]
    events: list[TimelineEvent]


class DeliveryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_id: int
    customer_name: Optional[str] = None
    pickup_lat: float
    pickup_lon: float
    dest_lat: float
    dest_lon: float
    pickup_address: Optional[str] = None
    dest_address: Optional[str] = None
    status: str
    drone_id: Optional[int]
    drone_name: Optional[str] = None
    priority: Optional[str] = "normal"
    package_type: Optional[str] = "standard"
    notes: Optional[str] = None
    weight_kg: Optional[float] = 1.0
    estimated_distance_km: Optional[float]
    estimated_duration_h: Optional[float]
    created_at: datetime
    completed_at: Optional[datetime]

    confirmation_code: Optional[str] = None
    confirmed_at: Optional[datetime] = None
    recipient_name: Optional[str] = None
    recipient_signature: Optional[str] = None
    delivery_photo_url: Optional[str] = None
    delivery_notes: Optional[str] = None
    failure_reason: Optional[str] = None


    dropoff_safety_status: Optional[str] = None
    dropoff_safety_reason: Optional[str] = None
    dropoff_weather_safe: Optional[str] = None
    dropoff_battery_pct: Optional[float] = None
    dropoff_distance_m: Optional[float] = None
    dropoff_code_required: Optional[str] = None


class ConfirmDeliveryRequest(BaseModel):
    """Request for confirming the reception of a delivery."""
    confirmation_code: str = Field(..., min_length=6, max_length=6, description="6-digit confirmation code")
    recipient_name: str = Field(..., min_length=2, max_length=100, description="Name of the person who received the package")
    recipient_signature: Optional[str] = Field(None, description="Signature in base64 format (optional)")
    delivery_photo_url: Optional[str] = Field(None, max_length=500, description="Optional proof photo URL used in demo flows")
    delivery_notes: Optional[str] = Field(None, max_length=500, description="Remarks or notes from the recipient")


class ProofOfDeliveryResponse(BaseModel):
    """Response with Proof of Delivery."""
    model_config = ConfigDict(from_attributes=True)
    
    delivery_id: int
    status: str

    pickup_lat: float
    pickup_lon: float
    dest_lat: float
    dest_lon: float
    pickup_address: Optional[str] = None
    dest_address: Optional[str] = None
    package_type: str
    weight_kg: float

    created_at: datetime
    completed_at: Optional[datetime]
    confirmed_at: Optional[datetime]

    confirmation_code: Optional[str]
    recipient_name: Optional[str]
    recipient_signature: Optional[str]
    delivery_photo_url: Optional[str]
    delivery_notes: Optional[str]


    dropoff_safety_status: Optional[str] = None
    dropoff_safety_reason: Optional[str] = None
    dropoff_weather_safe: Optional[str] = None
    dropoff_battery_pct: Optional[float] = None
    dropoff_distance_m: Optional[float] = None
    dropoff_code_required: Optional[str] = None

    drone_id: Optional[int]
    customer_id: int


class PaginatedDeliveriesResponse(BaseModel):
    """Paginated response for deliveries."""
    items: list[DeliveryResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_prev: bool


class DeliverySearchFilters(BaseModel):
    """Filters for delivery search."""
    status: Optional[list[str]] = None
    priority: Optional[list[str]] = None
    package_type: Optional[list[str]] = None
    drone_id: Optional[int] = None
    customer_id: Optional[int] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    completed_from: Optional[datetime] = None
    completed_to: Optional[datetime] = None
    search_id: Optional[int] = None
    confirmed: Optional[bool] = None
    min_weight: Optional[float] = None
    max_weight: Optional[float] = None
    order_type: Optional[str] = None


class DeliverySearchResponse(BaseModel):
    """Response for advanced search."""
    items: list[DeliveryResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    filters_applied: dict
    sort_by: str
    sort_order: str
