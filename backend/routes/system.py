from fastapi import APIRouter, Depends
from backend.services.auth_dependencies import require_role
from backend.services.drone_simulator import is_simulator_running
from backend.services.weather_service import _running as weather_running, METEOROMANIA_API_URL
from backend.routes.ws import manager
import time

router = APIRouter(prefix="/system", tags=["System"])

@router.get("/health")
def get_system_health(
    payload: dict = Depends(require_role("admin", "dispatcher")),
):
    """Returns detailed health status of core system components."""
    

    system_status = "online"
    

    ws_connections = len(manager.active_connections) if manager else 0
    ws_status = "online" if ws_connections > 0 else "degraded"
    if not manager:
        ws_status = "offline"
        

    weather_status = "online" if weather_running else "degraded"
    if not weather_running:
        weather_status = "offline"
    

    sim_running = is_simulator_running()
    sim_status = "online" if sim_running else "offline"
    
    return {
        "status": "online",
        "timestamp": time.time(),
        "components": {
            "system": {
                "status": system_status,
                "label": "API Server",
                "message": "Responding normally"
            },
            "websocket": {
                "status": ws_status,
                "label": "WebSocket",
                "message": f"{ws_connections} active clients",
                "clients": ws_connections
            },
            "weather": {
                "status": weather_status,
                "label": "Weather Sync",
                "message": "Syncing with Meteoromania (ANM)",
                "source": "meteoromania"
            },
            "simulator": {
                "status": sim_status,
                "label": "Simulator",
                "message": "Engine running" if sim_running else "Engine stopped/paused"
            }
        }
    }
