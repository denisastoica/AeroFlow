"""
Centralized operational alert service.

Creates persistent alerts in the DB and transmits them live via WebSocket.
Alert types:
  LOW_BATTERY         — drone battery below warning threshold
  WEATHER_HAZARD      — unfavorable weather conditions (wind, storm, low visibility)
  ROUTE_BLOCKED       — route blocked by no-fly zones, rerouting impossible
  AUTO_REASSIGN       — delivery automatically reassigned (faulty drone/insufficient battery)
  DELIVERY_FAILED     — delivery failed definitively
  MISSION_ABORTED     — mission cancelled (explicit or timeout)
  DRONE_STUCK         — drone stuck (no progress on route)
  BATTERY_CRITICAL    — battery below 5%, imminent forced landing
  NFZ_VIOLATION_RISK  — drone near a restricted area
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session

from backend.models.alert import Alert


LOW_BATTERY_THRESHOLD = 20.0
CRITICAL_BATTERY_THRESHOLD = 5.0

_COOLDOWN_SECONDS = 60


_alert_cooldown: dict[tuple, datetime] = {}


def _cooldown_key(alert_type: str, drone_id: Optional[int], delivery_id: Optional[int]) -> tuple:
    return (alert_type, drone_id, delivery_id)


def _is_on_cooldown(alert_type: str, drone_id: Optional[int], delivery_id: Optional[int]) -> bool:
    key = _cooldown_key(alert_type, drone_id, delivery_id)
    last = _alert_cooldown.get(key)
    if last is None:
        return False
    return (datetime.now(timezone.utc) - last).total_seconds() < _COOLDOWN_SECONDS


def _set_cooldown(alert_type: str, drone_id: Optional[int], delivery_id: Optional[int]) -> None:
    key = _cooldown_key(alert_type, drone_id, delivery_id)
    _alert_cooldown[key] = datetime.now(timezone.utc)


def _broadcast_alert(alert: Alert) -> None:
    """Transmits alert via WebSocket (non-blocking, thread-safe)."""
    try:
        from backend.routes.ws import manager
        if manager and manager.active_connections:
            manager.queue_broadcast({
                "type": "alert",
                "id": alert.id,
                "alert_type": alert.alert_type,
                "severity": alert.severity,
                "message": alert.message,
                "details": alert.details,
                "drone_id": alert.drone_id,
                "delivery_id": alert.delivery_id,
                "mission_id": alert.mission_id,
                "created_at": alert.created_at.isoformat(),
            })
    except Exception:
        pass


def create_alert(
    db: Session,
    alert_type: str,
    message: str,
    severity: str = "warning",
    drone_id: Optional[int] = None,
    delivery_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    details: Optional[str] = None,
    respect_cooldown: bool = True,
) -> Optional[Alert]:
    """
    Creates a persistent alert and transmits it live via WS.

    Parameters:
      alert_type       — type identifier (e.g., 'LOW_BATTERY')
      message          — short text displayed to operator
      severity         — 'info' | 'warning' | 'critical'
      drone_id         — associated drone (optional)
      delivery_id      — associated delivery (optional)
      mission_id       — associated mission (optional)
      details          — additional text (e.g., '14.2% battery', 'wind 72 km/h')
      respect_cooldown — if True, ignores duplicate alert within cooldown window
    """
    if respect_cooldown:
        existing = db.query(Alert).filter(
            Alert.alert_type == alert_type,
            Alert.drone_id == drone_id,
            Alert.delivery_id == delivery_id,
            Alert.status.in_(["new", "acknowledged"])
        ).first()
        if existing:
            return None

    alert = Alert(
        alert_type=alert_type,
        severity=severity,
        drone_id=drone_id,
        delivery_id=delivery_id,
        mission_id=mission_id,
        message=message,
        details=details,
        created_at=datetime.now(timezone.utc),
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)

    _broadcast_alert(alert)
    return alert


def alert_low_battery(db: Session, drone) -> Optional[Alert]:
    """Low battery alert (below thresholds)."""
    from backend.services.settings_service import get_settings
    settings = get_settings()
    crit_battery = settings.get("critical_battery", 5.0)

    if (drone.battery or 0) < crit_battery:
        return create_alert(
            db,
            alert_type="BATTERY_CRITICAL",
            message=f"Drone {drone.name} has CRITICAL battery: {drone.battery:.1f}%",
            severity="critical",
            drone_id=drone.id,
            details=f"battery={drone.battery:.1f}%",
        )
    if (drone.battery or 0) < LOW_BATTERY_THRESHOLD:
        return create_alert(
            db,
            alert_type="LOW_BATTERY",
            message=f"Drone {drone.name} has low battery: {drone.battery:.1f}%",
            severity="warning",
            drone_id=drone.id,
            details=f"battery={drone.battery:.1f}%",
        )
    return None


def alert_weather_hazard(db: Session, drone, warning: str, wind_speed=None) -> Optional[Alert]:
    """Hazardous weather conditions alert."""
    details = warning
    if wind_speed is not None:
        details = f"wind={wind_speed} km/h; {warning}"
    return create_alert(
        db,
        alert_type="WEATHER_HAZARD",
        message=f"Hazardous weather conditions at drone {drone.name}: {warning}",
        severity="warning",
        drone_id=drone.id,
        details=details,
    )


def alert_weather_grounded(db: Session, drone, warning: str) -> Optional[Alert]:
    """Severe weather alert — flight suspended."""
    return create_alert(
        db,
        alert_type="WEATHER_HAZARD",
        message=f"Drone {drone.name} suspended: {warning}",
        severity="critical",
        drone_id=drone.id,
        details=warning,
    )


def alert_route_blocked(db: Session, drone, delivery_id: Optional[int] = None) -> Optional[Alert]:
    """Route blocked alert — no valid path found."""
    return create_alert(
        db,
        alert_type="ROUTE_BLOCKED",
        message=f"Drone {drone.name} route is blocked by restricted areas",
        severity="critical",
        drone_id=drone.id,
        delivery_id=delivery_id,
        details="No valid grid path found",
    )


def alert_auto_reassign(db: Session, delivery_id: int, old_drone_name: str, reason: str = None) -> Optional[Alert]:
    """Automatic delivery reassignment alert."""
    return create_alert(
        db,
        alert_type="AUTO_REASSIGN",
        message=f"Delivery #{delivery_id} reassigned (drone {old_drone_name} cannot continue)",
        severity="warning",
        delivery_id=delivery_id,
        details=reason,
        respect_cooldown=False,
    )


def alert_delivery_failed(db: Session, delivery_id: int, reason: str = None) -> Optional[Alert]:
    """Delivery failed alert."""
    return create_alert(
        db,
        alert_type="DELIVERY_FAILED",
        message=f"Delivery #{delivery_id} has failed",
        severity="critical",
        delivery_id=delivery_id,
        details=reason,
        respect_cooldown=False,
    )


def alert_mission_aborted(db: Session, mission_id: int, drone, reason: str = None) -> Optional[Alert]:
    """Mission aborted alert."""
    return create_alert(
        db,
        alert_type="MISSION_ABORTED",
        message=f"Mission #{mission_id} of drone {drone.name} was aborted",
        severity="critical",
        drone_id=drone.id,
        mission_id=mission_id,
        details=reason,
        respect_cooldown=False,
    )


def alert_drone_stuck(db: Session, drone, steps: int) -> Optional[Alert]:
    """Drone stuck alert — no progress on route."""
    return create_alert(
        db,
        alert_type="DRONE_STUCK",
        message=f"Drone {drone.name} is stuck (no progress for {steps} ticks)",
        severity="critical",
        drone_id=drone.id,
        details=f"stuck_steps={steps}",
    )
