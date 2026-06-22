"""Scheme Pydantic pentru datele meteo."""
from pydantic import BaseModel
from typing import Optional, List


class WeatherZoneResponse(BaseModel):
    """Datele meteo pentru o zonă."""
    name: str
    center_lat: float
    center_lon: float
    radius_km: float
    condition: str
    condition_label: str
    condition_icon: str
    severity: int
    temperature: float
    wind_speed: float
    wind_direction: str
    humidity: float
    visibility_km: float
    speed_multiplier: float
    battery_multiplier: float
    can_fly: bool
    warning: Optional[str] = None
    api_description: Optional[str] = None
    source: Optional[str] = None


class WeatherAtResponse(WeatherZoneResponse):
    """Datele meteo la o locație specifică."""
    zone_name: str
    distance_to_zone_km: float


class AllWeatherResponse(BaseModel):
    """Răspunsul cu toate zonele meteo."""
    zones: List[WeatherZoneResponse]
    update_interval_sec: int


class WeatherImpactResponse(BaseModel):
    """Impactul vremii asupra dronei."""
    speed_multiplier: float
    battery_multiplier: float
    can_fly: bool
    condition: str
    wind_speed: float
    warning: Optional[str] = None
