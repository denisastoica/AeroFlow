import os
import sys


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr.encoding != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from contextlib import asynccontextmanager
from sqlalchemy.orm import sessionmaker

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from backend.database import engine, Base
from backend.migrations import run_migrations
from backend.routes.auth import router as auth_router, limiter as auth_limiter
from backend.routes.drones import router as drones_router
from backend.routes.users import router as users_router
from backend.routes.routing import router as routing_router
from backend.routes.charging import router as charging_router
from backend.routes.simulator import router as simulator_router
from backend.routes.deliveries import router as deliveries_router
from backend.routes.missions import router as missions_router
from backend.routes.ws import router as ws_router
from backend.routes.weather import router as weather_router
from backend.routes.no_fly_zones import router as no_fly_zones_router
from backend.routes.alerts import router as alerts_router
from backend.routes.audit import router as audit_router
from backend.routes.geocoding import router as geocoding_router
from backend.routes.system import router as system_router
from backend.routes.settings import router as settings_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application lifecycle (FastAPI Lifespan).
    Synchronizes service startup and database initialization.
    """

    if os.getenv("TESTING") == "1":
        yield
        return


    print("[Lifespan] Registering models and running migrations...")
    from backend.models import user, drone, delivery, mission, no_fly_zone, alert, audit_log, mission_event
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    print("[Lifespan] Database schema ready.")


    from backend.services.bootstrap_service import run_bootstrap
    from backend.routes.ws import manager as ws_manager
    import asyncio
    

    print("[Lifespan] Initializing WebSocket manager...")
    ws_manager.set_loop(asyncio.get_running_loop())
    
    print("[Lifespan] Running bootstrap service...")
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    try:
        run_bootstrap(db)
    finally:
        db.close()

    print("[Lifespan] Startup sequence complete. App is ready.")


    from backend.routes.weather import start_radar_background_refresh
    start_radar_background_refresh(interval_sec=120)

    yield
    print("[Lifespan] Shutting down...")

app = FastAPI(
    title="Drone Delivery Platform",
    description="API for drone delivery management, with JWT authentication and role-based access control.",
    version="1.0.0",
    lifespan=lifespan,
)


app.state.limiter = auth_limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    openapi_schema = get_openapi(
        title="Drone Delivery Platform",
        version="1.0.0",
        description="API with JWT authentication",
        routes=app.routes,
    )
    openapi_schema["components"]["securitySchemes"] = {
        "Bearer": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "JWT token for authentication. Format: Authorization: Bearer <token>",
        }
    }
    app.openapi_schema = openapi_schema
    return app.openapi_schema

app.openapi = custom_openapi


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router)
app.include_router(users_router)
app.include_router(drones_router)
app.include_router(routing_router)
app.include_router(charging_router)
app.include_router(simulator_router)
app.include_router(deliveries_router)
app.include_router(missions_router)
app.include_router(weather_router)
app.include_router(no_fly_zones_router)
app.include_router(alerts_router)
app.include_router(audit_router)
app.include_router(geocoding_router)
app.include_router(system_router)
app.include_router(ws_router)
app.include_router(settings_router)

@app.get("/")
def home():
    return {"message": "Drone Delivery Platform is active"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
