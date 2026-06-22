from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.services.drone_simulator import pause_simulator, resume_simulator
from backend.services.fleet_reset_service import reset_fleet_for_demo
from backend.services.demo_scenarios import run_scenario, SCENARIO_META
from backend.services.weather_service import clear_scenario_overrides
from backend.models.drone import Drone
from backend.models.delivery import Delivery
from backend.app.core.delivery_state import ACTIVE_DELIVERY_STATUSES
from backend.routes.ws import manager
from backend.services.auth_dependencies import require_role

router = APIRouter(prefix="/simulator", tags=["Simulator"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/pause")
def api_pause_simulator(
    payload: dict = Depends(require_role("admin", "dispatcher")),
):
    pause_simulator()
    return {"status": "paused"}


@router.post("/resume")
def api_resume_simulator(
    payload: dict = Depends(require_role("admin", "dispatcher")),
):
    resume_simulator()
    return {"status": "running"}

from backend.services.drone_simulator import is_simulator_running

@router.get("/status")
def api_get_simulator_status():
    if is_simulator_running():
        return {"status": "running"}
    return {"status": "paused"}


@router.post("/abort_mission/{drone_id}")
def abort_mission(
    drone_id: int,
    payload: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if not drone:
        raise HTTPException(status_code=404, detail="Drone not found")

    from backend.services.delivery_service import cancel_delivery
    

    active_del = db.query(Delivery).filter(
        Delivery.drone_id == drone.id,
        Delivery.status.in_(list(ACTIVE_DELIVERY_STATUSES))
    ).first()

    if active_del:
        cancel_delivery(db, active_del.id, reason="Aborted by dispatcher")
    

    drone.status = "idle"
    drone.route_path = None
    drone.route_index = 0
    drone.dest_latitude = None
    drone.dest_longitude = None
    drone.stuck_steps = 0
    

    from backend.services.mission_service import get_active_mission_for_drone, abort_mission as abort_mission_record
    active_mission = get_active_mission_for_drone(db, drone.id)
    if active_mission:
        abort_mission_record(db, active_mission.delivery_id, reason="Aborted by dispatcher (orphaned mission)")

    db.commit()
    db.refresh(drone)

    try:
        if manager and getattr(manager, "active_connections", None):
            manager.queue_broadcast(
                {
                    "type": "drone_update",
                    "drone_id": int(drone.id),
                    "status": drone.status,
                    "latitude": drone.latitude,
                    "longitude": drone.longitude,
                    "battery": drone.battery,
                    "route_index": int(drone.route_index or 0),
                    "route_path": None,
                }
            )
    except Exception:
        pass

    return {"status": "aborted", "drone": drone}


@router.post("/reset-fleet")
def reset_fleet(
    payload: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    """
    Demo: all drones → idle, 100% battery, no route; open missions closed;
    assigned/in_progress deliveries → pending. Completes fleet to at least 12 preset drones.
    """
    result = reset_fleet_for_demo(db)
    try:
        if manager and getattr(manager, "active_connections", None):
            manager.queue_broadcast(
                {
                    "type": "fleet_update",
                    "reset_fleet": True,
                    "summary": result,
                }
            )
    except Exception:
        pass
    return {"message": "Fleet reset for demo", **result}


@router.get("/scenarios")
def list_scenarios(
    payload: dict = Depends(require_role("admin", "dispatcher")),
):
    """Returns the list of available demo scenarios with metadata."""
    return {
        "scenarios": [
            {"id": sid, **meta}
            for sid, meta in SCENARIO_META.items()
        ]
    }


@router.post("/scenario/clear-weather")
def clear_weather_overrides(
    payload: dict = Depends(require_role("admin", "dispatcher")),
):
    """Clears all weather overrides created by demo scenarios."""
    clear_scenario_overrides()
    return {"message": "Weather overrides cleared. Conditions return to real values."}


@router.post("/scenario/{scenario_id}")
def run_demo_scenario(
    scenario_id: str,
    payload: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    """
    Runs a preset demo scenario.
    Available scenarios: bad_weather, nfz_conflict, low_battery,
    auto_reassign, urgent_delivery, fleet_stress, freeze_thaw.
    """
    result = run_scenario(scenario_id, db)


    try:
        if manager and getattr(manager, "active_connections", None):
            manager.queue_broadcast(
                {
                    "type": "scenario_started",
                    "scenario_id": scenario_id,
                    "status": result.get("status"),
                    "message": result.get("message"),
                }
            )
    except Exception:
        pass

    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message"))

    return result
