from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging
import asyncio
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.models.user import User
from backend.models.drone import Drone
from backend.models.delivery import Delivery
from backend.services.auth_service import verify_token

router = APIRouter()
logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.connection_context: dict[WebSocket, dict] = {}


        self._async_queue: asyncio.Queue = None
        self._loop: asyncio.AbstractEventLoop = None
        self._broadcast_task = None

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        """Set the event loop, create async queue, and start the broadcast task."""
        self._loop = loop
        self._async_queue = asyncio.Queue()
        self._broadcast_task = loop.create_task(self._broadcast_loop())
        logger.info("[WS] Broadcast loop started in main event loop.")

    async def _broadcast_loop(self):
        """Consume the asyncio.Queue in the event loop — zero thread-pool overhead."""
        while True:
            try:
                data = await self._async_queue.get()
                if data is None:
                    break
                await self._async_broadcast(data)
            except Exception as e:
                logger.error(f"[WS] Broadcast loop error: {e}")
                await asyncio.sleep(0.1)

    async def _async_broadcast(self, data: dict):
        """Async broadcast method running in the main loop."""
        if not self.active_connections:
            return

        disconnected = []

        for connection in list(self.active_connections):
            try:
                ctx = self.connection_context.get(connection)
                if self._is_message_allowed(data, ctx):
                    await connection.send_json(data)
            except Exception as e:
                logger.error(f"[WS] Error sending to client: {e}")
                disconnected.append(connection)
        
        for conn in disconnected:
            self.disconnect(conn)

    async def connect(self, websocket: WebSocket, context: dict):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_context[websocket] = context
        logger.info(f"[WS] Client connected ({context.get('role')}). Total: {len(self.active_connections)}")
        

        if self._loop is None:
            self.set_loop(asyncio.get_running_loop())

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            self.connection_context.pop(websocket, None)
            logger.info(f"[WS] Client disconnected. Total: {len(self.active_connections)}")

    def queue_broadcast(self, data: dict):
        """Enqueue a message for broadcast from any thread (thread-safe, non-blocking)."""
        if self._loop is None or self._async_queue is None:
            return
        try:
            self._loop.call_soon_threadsafe(self._async_queue.put_nowait, data)
        except Exception as e:
            logger.debug("[WS] Failed to queue broadcast: %s", e)

    def broadcast_delivery_update(self, delivery: Delivery):
        """Helper to broadcast a standardized delivery update."""
        self.queue_broadcast({
            "type": "delivery_update",
            "delivery_id": int(delivery.id),
            "status": delivery.status,
            "drone_id": int(delivery.drone_id) if delivery.drone_id else None,
            "customer_id": int(delivery.customer_id) if delivery.customer_id else None,
            "dropoff_safety_status": getattr(delivery, "dropoff_safety_status", None),
            "dropoff_safety_reason": getattr(delivery, "dropoff_safety_reason", None),
            "dropoff_weather_safe": getattr(delivery, "dropoff_weather_safe", None),
            "dropoff_battery_pct": getattr(delivery, "dropoff_battery_pct", None),
            "dropoff_distance_m": getattr(delivery, "dropoff_distance_m", None),
            "dropoff_code_required": getattr(delivery, "dropoff_code_required", None),
            "confirmed_at": delivery.confirmed_at.isoformat() if delivery.confirmed_at else None,
        })

    def _is_message_allowed(self, data: dict, ctx: dict | None) -> bool:
        """Filter outgoing WS messages by role scope."""
        if not ctx:
            return False
        role = ctx.get("role")
        if role in ("admin", "dispatcher"):
            return True


        msg_type = data.get("type")
        if msg_type in ("fleet_update", "alert"):
            return False

        if role == "customer":
            delivery_id = data.get("delivery_id")
            if delivery_id is None:

                return True
            allowed_ids = ctx.get("allowed_delivery_ids", set())
            return delivery_id in allowed_ids

        return False


manager = ConnectionManager()


def _build_ws_context(db: Session, payload: dict) -> dict | None:
    user_id = payload.get("sub")
    role = payload.get("role")
    if user_id is None or role is None:
        return None

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        return None

    context = {
        "user_id": user.id,
        "role": user.role,
        "allowed_drone_ids": set(),
        "allowed_delivery_ids": set(),
    }

    if user.role == "customer":
        context["allowed_delivery_ids"] = {
            d[0] for d in db.query(Delivery.id).filter(Delivery.customer_id == user.id).all()
        }
    return context


@router.websocket("/ws/monitor")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time drone monitoring"""
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008, reason="Missing token")
        return

    payload = verify_token(token)
    if not payload:
        await websocket.close(code=1008, reason="Invalid token")
        return

    db = SessionLocal()
    try:
        context = _build_ws_context(db, payload)
    finally:
        db.close()

    if not context:
        await websocket.close(code=1008, reason="Unauthorized")
        return

    await manager.connect(websocket, context)
    try:
        while True:

            await websocket.receive_text()

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"[WS] Unexpected error: {e}")
        manager.disconnect(websocket)
