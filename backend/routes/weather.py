"""API routes for weather data."""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response
import requests as http_requests
import re
import threading
import time
from datetime import datetime, timezone

from backend.services.weather_service import (
    get_all_weather,
    get_weather_at,
    get_weather_impact_at,
    UPDATE_INTERVAL_SEC,
)
from backend.schemas.weather import (
    AllWeatherResponse,
    WeatherAtResponse,
    WeatherImpactResponse,
)

router = APIRouter(prefix="/weather", tags=["Weather"])


_ANM_RADAR_JSON = "https://www.meteoromania.ro/wp-content/plugins/meteo/json/imagini-radar.php"
_ANM_RADAR_BASE = "https://www.meteoromania.ro/radar/"
_PROXY_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.meteoromania.ro/",
}
_RADAR_CACHE: dict = {
    "latest": None,
    "timestamp": 0,
    "image_bytes": None,
    "image_filename": None,
}
_RADAR_LOCK = threading.Lock()


def _refresh_radar_cache() -> bool:
    """Fetch latest radar frame + image and store in cache. Returns True on success."""
    try:
        resp = http_requests.get(_ANM_RADAR_JSON, headers=_PROXY_HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        images = []
        for item in data.get("poze", {}).values():
            poza = item.get("poza", "")
            m = re.search(r"mos\.live\.(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})", poza)
            if m:
                try:
                    frame_dt = datetime(*map(int, m.groups()), tzinfo=timezone.utc)
                    images.append((frame_dt.timestamp(), item))
                except ValueError:
                    continue

        if not images:
            return False


        images.sort(key=lambda x: x[0], reverse=True)

        for ts, latest_obj in images:
            poza_url = latest_obj.get("poza", "")
            filename = poza_url.split("/")[-1].split("?")[0]

            img_resp = http_requests.get(poza_url, headers=_PROXY_HEADERS, timeout=20)
            if img_resp.status_code == 200:
                with _RADAR_LOCK:
                    _RADAR_CACHE["latest"] = latest_obj
                    _RADAR_CACHE["timestamp"] = time.time()
                    _RADAR_CACHE["image_bytes"] = img_resp.content
                    _RADAR_CACHE["image_filename"] = filename

                print(f"[Radar] Cache updated: {filename} ({len(img_resp.content)} bytes)")
                return True
            else:
                print(f"[Radar] Image {filename} not available yet (HTTP {img_resp.status_code}), trying older...")

        return False

    except Exception as exc:
        print(f"[Radar] Refresh failed: {exc}")
        return False


def start_radar_background_refresh(interval_sec: int = 600):
    """Start a daemon thread that refreshes radar cache every interval_sec seconds."""
    def _loop():
        _refresh_radar_cache()
        while True:
            time.sleep(interval_sec)
            _refresh_radar_cache()

    t = threading.Thread(target=_loop, daemon=True, name="radar-refresh")
    t.start()
    print("[Radar] Background refresh thread started.")


@router.get("/", response_model=AllWeatherResponse)
def get_current_weather():
    """Returns current weather conditions for all zones."""
    zones = get_all_weather()
    return {"zones": zones, "update_interval_sec": UPDATE_INTERVAL_SEC}


@router.get("/at")
def get_weather_at_location(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
):
    """Returns weather conditions at a specific location."""
    return get_weather_at(lat, lon)


@router.get("/impact")
def get_weather_impact(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
):
    """Returns the weather impact on a drone at a location."""
    return get_weather_impact_at(lat, lon)


@router.get("/warnings")
def get_weather_warnings():
    """Returns the latest active weather warnings from ANM (Nowcast and General)."""
    from backend.services.warning_service import get_active_warnings
    return get_active_warnings()


@router.get("/radar/list")
def get_radar_image_list():
    """Returns the latest cached radar frame. Attempts a quick refresh if empty."""
    with _RADAR_LOCK:
        latest = _RADAR_CACHE.get("latest")
        cached = bool(_RADAR_CACHE.get("timestamp"))

    if not latest:

        if _refresh_radar_cache():
            with _RADAR_LOCK:
                latest = _RADAR_CACHE.get("latest")
                cached = bool(_RADAR_CACHE.get("timestamp"))

    if latest:
        return JSONResponse(
            content={"latest": latest, "cached": cached},
            headers={"Cache-Control": "no-store"},
        )
    return JSONResponse(
        content={"error": "Radar cache currently unavailable from ANM, try again shortly"},
        status_code=404,
    )


@router.get("/radar/image/{filename}")
def get_radar_image(filename: str):
    """Serves radar image from in-memory cache. Never blocks on external HTTP."""
    if not filename.endswith(".png") or ".." in filename or "/" in filename:
        return Response(content="Invalid filename", status_code=400)

    with _RADAR_LOCK:
        cached_name = (_RADAR_CACHE.get("image_filename") or "").split("?")[0]
        image_bytes = _RADAR_CACHE.get("image_bytes")

    if image_bytes and cached_name == filename:
        return Response(
            content=image_bytes,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*"},
        )
    return Response(content="Image not yet cached", status_code=404)
