"""
Advanced drone battery management service.
Realistic modeling: degradation, efficiency, consumption based on weight/wind/altitude,
autonomy estimation, alerts, charging cycles.
"""
import math
from typing import Optional

from backend.services.grid import haversine_distance


BASE_CONSUMPTION_WH_PER_KM = 3.0

HOVER_CONSUMPTION_WH_PER_MIN = 2.5
MAX_SPEED_KMH = 60.0
CHARGE_RATE_NORMAL_WH = 40.0
CHARGE_RATE_FAST_WH = 80.0


DEGRADATION_PER_CYCLE = 0.08
DEGRADATION_PER_1000KM = 0.3
CRITICAL_HEALTH_PCT = 50.0
LOW_HEALTH_PCT = 70.0


BATTERY_CRITICAL_PCT = 5.0
BATTERY_LOW_PCT = 15.0
BATTERY_RESERVE_PCT = 10.0


def effective_capacity_wh(max_battery_wh: float, battery_health: float) -> float:
    """Effective battery capacity, reduced by degradation."""
    return max_battery_wh * (battery_health / 100.0)


def battery_pct_to_wh(battery_pct: float, max_battery_wh: float, battery_health: float) -> float:
    """Converts battery percentage to available Wh."""
    eff = effective_capacity_wh(max_battery_wh, battery_health)
    return eff * (battery_pct / 100.0)


def battery_wh_to_pct(wh: float, max_battery_wh: float, battery_health: float) -> float:
    """Converts Wh to percentage of effective capacity."""
    eff = effective_capacity_wh(max_battery_wh, battery_health)
    if eff <= 0:
        return 0.0
    return min(100.0, max(0.0, (wh / eff) * 100.0))


def compute_consumption_wh(
    distance_km: float,
    weight_kg: float = 3.5,
    motor_efficiency: float = 0.92,
    battery_health: float = 100.0,
    weather_battery_mult: float = 1.0,
) -> float:
    """
    Calculates energy consumption (Wh) for a given distance.
    
    Factors:
    - Weight: linear consumption with mass
    - Motor efficiency: degraded motors consume more
    - Battery health: old battery = higher internal resistance
    - Weather: external multiplier from weather_service
    """


    weight_factor = (weight_kg / 3.5) ** 0.5


    efficiency_factor = 1.0 / max(0.5, motor_efficiency)


    health_factor = 1.0 + (100.0 - battery_health) * 0.004


    base_wh = BASE_CONSUMPTION_WH_PER_KM * distance_km

    total_wh = base_wh * weight_factor * efficiency_factor * health_factor * weather_battery_mult

    return max(0.1, total_wh)


def compute_battery_drain_pct(
    distance_km: float,
    max_battery_wh: float = 500.0,
    battery_health: float = 100.0,
    weight_kg: float = 3.5,
    motor_efficiency: float = 0.92,
    weather_battery_mult: float = 1.0,
) -> float:
    """
    Calculates battery percentage consumed for a distance.
    """
    wh_consumed = compute_consumption_wh(
        distance_km, weight_kg, motor_efficiency,
        battery_health, weather_battery_mult,
    )
    eff_capacity = effective_capacity_wh(max_battery_wh, battery_health)
    if eff_capacity <= 0:
        return 100.0
    return (wh_consumed / eff_capacity) * 100.0


def estimate_range_km(
    battery_pct: float,
    max_battery_wh: float = 500.0,
    battery_health: float = 100.0,
    weight_kg: float = 3.5,
    motor_efficiency: float = 0.92,
    weather_battery_mult: float = 1.0,
) -> float:
    """
    Estimates remaining range (km) based on current battery.
    Subtracts safety reserve from available calculation.
    """
    usable_pct = max(0, battery_pct - BATTERY_RESERVE_PCT)
    available_wh = battery_pct_to_wh(usable_pct, max_battery_wh, battery_health)


    cost_per_km = compute_consumption_wh(
        1.0, weight_kg, motor_efficiency, battery_health, weather_battery_mult
    )
    if cost_per_km <= 0:
        return 0.0
    return available_wh / cost_per_km


def apply_charge_step(
    battery_pct: float,
    max_battery_wh: float,
    battery_health: float,
    fast_charge: bool = False,
) -> tuple:
    """
    Applies a charging step. Returns (new_battery_pct, wh_charged).
    Charging slows down above 80% (realistic simulation).
    """
    eff_capacity = effective_capacity_wh(max_battery_wh, battery_health)
    current_wh = battery_pct_to_wh(battery_pct, max_battery_wh, battery_health)

    rate = CHARGE_RATE_FAST_WH if fast_charge else CHARGE_RATE_NORMAL_WH


    if battery_pct > 80:
        slowdown = 1.0 - (battery_pct - 80) / 40.0
        rate *= max(0.3, slowdown)

    new_wh = min(eff_capacity, current_wh + rate)
    wh_charged = new_wh - current_wh
    new_pct = battery_wh_to_pct(new_wh, max_battery_wh, battery_health)

    return round(new_pct, 1), wh_charged


def apply_degradation(
    battery_health: float,
    total_charge_cycles: int,
    total_flight_km: float,
    wh_charged: float,
    max_battery_wh: float,
    fast_charge: bool = False,
) -> tuple:
    """
    Applies battery degradation after charging.
    Returns (new_health, new_cycles).
    
    Causes of degradation:
    - Charge cycles (each full cycle = ~0.08%)
    - Km flown (mechanical + chemical wear)
    - Fast charge (additional 50% degradation)
    """
    eff_capacity = effective_capacity_wh(max_battery_wh, battery_health)
    if eff_capacity <= 0:
        return battery_health, total_charge_cycles


    cycle_fraction = wh_charged / eff_capacity


    health_loss = DEGRADATION_PER_CYCLE * cycle_fraction
    if fast_charge:
        health_loss *= 1.5

    new_health = max(0, battery_health - health_loss)


    new_cycles = total_charge_cycles

    if cycle_fraction >= 0.5:
        new_cycles += 1

    return round(new_health, 2), new_cycles


def apply_flight_degradation(
    battery_health: float,
    distance_km: float,
) -> float:
    """
    Applies degradation based on flight distance.
    Called at each flight step.
    """
    health_loss = (distance_km / 1000.0) * DEGRADATION_PER_1000KM
    return max(0, round(battery_health - health_loss, 4))


def compute_effective_speed(
    weight_kg: float = 3.5,
    weather_speed_mult: float = 1.0,
) -> float:
    """
    Calculates effective drone speed (km/h) considering:
    - Total weight (drone + package): each kg over 3.5 decreases speed by ~2%
    - Weather multiplier (wind, rain, fog)
    """

    weight_penalty = max(0.6, 1.0 - (weight_kg - 3.5) * 0.02)
    speed = MAX_SPEED_KMH * weight_penalty * max(0.1, weather_speed_mult)
    return round(speed, 1)


def estimate_duration_h(
    route_distance_km: float,
    weight_kg: float = 3.5,
    weather_speed_mult: float = 1.0,
    charging_stops: int = 0,
) -> float:
    """
    Estimates total delivery duration (hours) including:
    - Flight time at effective speed
    - Charging time per stop (~15 min at station)
    - Takeoff/landing overhead (2 min per segment)
    """
    speed = compute_effective_speed(weight_kg, weather_speed_mult)
    if speed <= 0:
        return 0.0
    flight_h = route_distance_km / speed
    charge_h = charging_stops * 0.25
    overhead_h = (charging_stops + 1) * (2.0 / 60.0)
    return round(flight_h + charge_h + overhead_h, 4)


def get_battery_status(battery_pct: float, battery_health: float) -> dict:
    """
    Returns battery status with alert level.
    """

    if battery_pct <= BATTERY_CRITICAL_PCT:
        level = "critical"
        level_label = "CRITICAL"
        level_color = "#dc3545"
    elif battery_pct <= BATTERY_LOW_PCT:
        level = "low"
        level_label = "Low"
        level_color = "#fd7e14"
    elif battery_pct <= 30:
        level = "medium"
        level_label = "Medium"
        level_color = "#ffc107"
    else:
        level = "good"
        level_label = "Good"
        level_color = "#28a745"


    if battery_health <= CRITICAL_HEALTH_PCT:
        health_status = "replace"
        health_label = "Replacement required"
        health_color = "#dc3545"
    elif battery_health <= LOW_HEALTH_PCT:
        health_status = "degraded"
        health_label = "Degraded"
        health_color = "#fd7e14"
    elif battery_health <= 85:
        health_status = "fair"
        health_label = "Fair"
        health_color = "#ffc107"
    else:
        health_status = "good"
        health_label = "Good"
        health_color = "#28a745"

    return {
        "battery_pct": round(battery_pct, 1),
        "level": level,
        "level_label": level_label,
        "level_color": level_color,
        "health_pct": round(battery_health, 1),
        "health_status": health_status,
        "health_label": health_label,
        "health_color": health_color,
    }
