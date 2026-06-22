"""
Weather service for the drone system.
Uses Meteoromania (ANM) free public API for real-time weather data.
Endpoint: https://www.meteoromania.ro/wp-json/meteoapi/v2/starea-vremii

No API key required — the endpoint is publicly accessible.
Coordinates in the API response are in Web Mercator (EPSG:3857) projection
and are converted to WGS84 (lat/lon) for internal use.

Affects drone speed and battery consumption.
"""
import math
import re
import time
import threading
import requests as http_requests
from typing import Dict, List, Optional
from dataclasses import dataclass, field


METEOROMANIA_API_URL = "https://www.meteoromania.ro/wp-json/meteoapi/v2/starea-vremii"
UPDATE_INTERVAL_SEC = 600


WEATHER_TYPES = {
    "clear":      {"label": "Clear",        "icon": "☀️",  "severity": 0},
    "cloudy":     {"label": "Cloudy",       "icon": "☁️",  "severity": 1},
    "fog":        {"label": "Fog",          "icon": "🌫️", "severity": 2},
    "light_rain": {"label": "Light Rain",   "icon": "🌦️", "severity": 2},
    "rain":       {"label": "Rain",         "icon": "🌧️", "severity": 3},
    "heavy_rain": {"label": "Heavy Rain",   "icon": "⛈️", "severity": 4},
    "snow":       {"label": "Snow",         "icon": "🌨️", "severity": 3},
    "storm":      {"label": "Storm",        "icon": "⛈️", "severity": 5},
}


ANM_ICON_MAP: Dict[int, str] = {
    1:  "clear",
    2:  "clear",
    3:  "cloudy",
    4:  "cloudy",
    5:  "cloudy",
    6:  "light_rain",
    7:  "rain",
    8:  "heavy_rain",
    9:  "storm",
    10: "snow",
    11: "snow",
    12: "snow",
    13: "snow",
    14: "fog",
    15: "light_rain",
    16: "light_rain",
    17: "storm",
    18: "cloudy",
    29: "fog",
    30: "light_rain",
    84: None,
}


ANM_FENOMEN_MAP: Dict[str, str] = {
    "ceata":           "fog",
    "burna":           "light_rain",
    "ploaie slaba":    "light_rain",
    "ploaie":          "rain",
    "ploaie moderata": "rain",
    "ploaie puternica":"heavy_rain",
    "ninsoare":        "snow",
    "viscol":          "storm",
    "furtuna":         "storm",
    "grindina":        "storm",
    "averse":          "light_rain",
    "averse de ploaie":"light_rain",
    "lapovita":        "light_rain",
}


ANM_NEBULOZITATE_MAP: Dict[str, str] = {
    "cer senin":        "clear",
    "cer partial noros":"cloudy",
    "cer noros":        "cloudy",
    "cer acoperit":     "cloudy",
    "cer invizibil":    "fog",
    "indisponibil":     "clear",
}


ZONE_STATIONS = {
    "Cluj-Napoca":         "CLUJ-NAPOCA",
    "Brasov":              "BRASOV GHIMBAV",
    "Bucharest":           "BUCURESTI BANEASA",
    "Timisoara":           "TIMISOARA",
    "Sibiu":               "SIBIU",
    "Iasi":                "IASI",
    "Constanta":           "CONSTANTA",
    "Oradea":              "ORADEA",
    "Craiova":             "CRAIOVA",
    "Galati":              "GALATI",
}


def _merc_x_to_lon(x: float) -> float:
    """Converts Web Mercator X (meters) to longitude (degrees)."""
    return math.degrees(x / 6378137.0)


def _merc_y_to_lat(y: float) -> float:
    """Converts Web Mercator Y (meters) to latitude (degrees)."""
    return math.degrees(2.0 * math.atan(math.exp(y / 6378137.0)) - math.pi / 2)


def _parse_wind_speed(vant_text: str) -> float:
    """
    Extracts wind speed in km/h from the Romanian wind description.
    Example: '3.1 m/s, directia : NNE' → 11.16 km/h
    """
    match = re.search(r"([\d.]+)\s*m/s", vant_text or "")
    if match:
        ms = float(match.group(1))
        return round(ms * 3.6, 1)
    return 0.0


def _parse_wind_direction(vant_text: str) -> str:
    """
    Extracts wind direction from the Romanian wind description.
    Example: '3.1 m/s, directia : NNE' → 'NNE'
    """
    match = re.search(r"directia\s*:\s*([A-Z]+)", vant_text or "")
    return match.group(1) if match else "N"


def _condition_from_icon_and_props(icon: int, fenomen_e: str, nebulozitate: str) -> str:
    """
    Determines the internal weather condition from ANM data fields.
    Priority: fenomen_e (exact text) > icon (if not 84) > nebulozitate > default
    """

    fen = (fenomen_e or "").lower().strip()
    if fen and fen != "indisponibil":
        for key, val in ANM_FENOMEN_MAP.items():
            if key in fen:
                return val
        if "ceata" in fen or "cetos" in fen:
            return "fog"
            

    cond = ANM_ICON_MAP.get(icon)
    if cond is not None:
        return cond


    neb = (nebulozitate or "").lower().strip()
    for key, val in ANM_NEBULOZITATE_MAP.items():
        if key in neb:
            return val

    return "clear"


@dataclass
class WeatherZone:
    """Represents a weather zone with current conditions (from ANM real API)."""
    name: str
    center_lat: float
    center_lon: float
    radius_km: float
    condition: str = "clear"
    temperature: float = 20.0
    wind_speed: float = 0.0
    wind_direction: str = "N"
    humidity: float = 50.0
    visibility_km: float = 10.0
    last_update: float = 0.0
    api_description: str = ""

    def to_dict(self) -> dict:
        meta = WEATHER_TYPES.get(self.condition, WEATHER_TYPES["clear"])
        impact = compute_weather_impact(self.condition, self.wind_speed, self.temperature)
        return {
            "name": self.name,
            "center_lat": self.center_lat,
            "center_lon": self.center_lon,
            "radius_km": self.radius_km,
            "condition": self.condition,
            "condition_label": meta["label"],
            "condition_icon": meta["icon"],
            "severity": meta["severity"],
            "temperature": round(self.temperature, 1),
            "wind_speed": round(self.wind_speed, 1),
            "wind_direction": self.wind_direction,
            "humidity": round(self.humidity, 1),
            "visibility_km": round(self.visibility_km, 1),
            "speed_multiplier": round(impact["speed_multiplier"], 2),
            "battery_multiplier": round(impact["battery_multiplier"], 2),
            "can_fly": impact["can_fly"],
            "warning": impact["warning"],
            "api_description": self.api_description,
            "source": "meteoromania",
        }


def compute_weather_impact(condition: str, wind_speed: float, temperature: float) -> dict:
    """
    Calculates weather impact on the drone.
    Returns multipliers for speed and battery consumption.
    wind_speed is expected in km/h.
    """
    speed_mult = 1.0
    battery_mult = 1.0
    can_fly = True
    warning = None

    if condition == "clear":
        speed_mult = 1.0
        battery_mult = 1.0
    elif condition == "cloudy":
        speed_mult = 0.95
        battery_mult = 1.02
    elif condition == "fog":
        speed_mult = 0.7
        battery_mult = 1.05
        warning = "Reduced visibility - flight slowed"
    elif condition == "light_rain":
        speed_mult = 0.85
        battery_mult = 1.15
        warning = "Light rain - increased consumption"
    elif condition == "rain":
        speed_mult = 0.7
        battery_mult = 1.3
        warning = "Rain - significantly increased consumption"
    elif condition == "heavy_rain":
        speed_mult = 0.5
        battery_mult = 1.5
        warning = "Heavy rain - dangerous flight"
    elif condition == "snow":
        speed_mult = 0.6
        battery_mult = 1.4
        warning = "Snow - reduced performance"
    elif condition == "storm":
        speed_mult = 0.0
        battery_mult = 2.0
        can_fly = False
        warning = "STORM - flight prohibited!"


    if wind_speed > 10:
        wind_factor = min((wind_speed - 10) / 40, 1.0)
        speed_mult *= (1.0 - wind_factor * 0.4)
        battery_mult *= (1.0 + wind_factor * 0.6)

    from backend.services.settings_service import get_settings
    settings = get_settings()
    max_wind = settings.get("max_wind", 45.0)

    if wind_speed >= max_wind:
        can_fly = False
        warning = "Wind too strong (>{:.0f} km/h) - flight prohibited!".format(wind_speed)


    if temperature < -5:
        battery_mult *= 1.3
        warning = warning or "Low temperature - battery affected"
    elif temperature < 5:
        battery_mult *= 1.1
    elif temperature > 40:
        battery_mult *= 1.15
        warning = warning or "High temperature - battery affected"

    return {
        "speed_multiplier": max(0.1, speed_mult),
        "battery_multiplier": battery_mult,
        "can_fly": can_fly,
        "warning": warning,
    }


WEATHER_ZONES: List[WeatherZone] = [
    WeatherZone("Cluj-Napoca", 46.77, 23.62, 40),
    WeatherZone("Brasov",      45.65, 25.60, 40),
    WeatherZone("Bucharest",   44.43, 26.10, 50),
    WeatherZone("Timisoara",   45.75, 21.21, 40),
    WeatherZone("Sibiu",       45.94, 24.97, 35),
    WeatherZone("Iasi",        47.16, 27.59, 40),
    WeatherZone("Constanta",   44.16, 28.63, 40),
    WeatherZone("Oradea",      47.05, 21.92, 35),
    WeatherZone("Craiova",     44.32, 23.80, 35),
    WeatherZone("Galati",      45.27, 27.98, 35),
]


_weather_lock = threading.Lock()


_scenario_overrides: Dict[str, Dict] = {}


_anm_features_cache: List[dict] = []


def force_scenario_weather(zone_name: str, condition: str, duration_sec: int = 120) -> bool:
    """Forces a weather condition in a zone for demo scenarios."""
    _scenario_overrides[zone_name] = {
        "condition": condition,
        "expires_at": time.time() + duration_sec,
    }
    _broadcast_weather_update()
    

    threading.Timer(duration_sec + 0.5, _broadcast_weather_update).start()
    
    return True


def clear_scenario_overrides() -> None:
    """Clears all scenario overrides."""
    _scenario_overrides.clear()
    _broadcast_weather_update()


def _fetch_anm_data() -> Optional[List[dict]]:
    """
    Fetches current weather data from the Meteoromania (ANM) public API.
    Returns a list of feature property dicts (with added lat/lon), or None on error.
    No API key required.
    """
    try:
        resp = http_requests.get(
            METEOROMANIA_API_URL,
            timeout=15,
            headers={"User-Agent": "DroneDeliveryApp/1.0"},
        )
        if resp.status_code != 200:
            print(f"[Weather] ANM API error {resp.status_code}: {resp.text[:200]}")
            return None

        data = resp.json()
        features = data.get("features", [])
        result = []
        for feat in features:
            props = feat.get("properties", {})
            coords = feat.get("geometry", {}).get("coordinates", [])
            if len(coords) >= 2:
                try:

                    lon = _merc_x_to_lon(float(coords[0]))
                    lat = _merc_y_to_lat(float(coords[1]))
                    props = dict(props)
                    props["_lat"] = lat
                    props["_lon"] = lon
                except (ValueError, TypeError):
                    continue
            result.append(props)
        return result

    except Exception as e:
        print(f"[Weather] ANM request failed: {e}")
        return None


def _find_nearest_station(lat: float, lon: float, features: List[dict]) -> Optional[dict]:
    """Finds the nearest station from the ANM feature list to the given lat/lon."""
    best = None
    best_dist = float("inf")
    for props in features:
        s_lat = props.get("_lat")
        s_lon = props.get("_lon")
        if s_lat is None or s_lon is None:
            continue
        from backend.services.grid import haversine_distance
        d = haversine_distance(lat, lon, s_lat, s_lon)
        if d < best_dist:
            best_dist = d
            best = props
    return best


def _props_to_zone_data(props: dict) -> dict:
    """Converts ANM station properties to our internal weather dict."""
    icon = int(props.get("icon", 84)) if str(props.get("icon", "84")).isdigit() else 84
    fenomen_e = props.get("fenomen_e", "indisponibil")
    nebulozitate = props.get("nebulozitate", "indisponibil")
    condition = _condition_from_icon_and_props(icon, fenomen_e, nebulozitate)


    try:
        temperature = float(props.get("tempe", 20.0))
    except (TypeError, ValueError):
        temperature = 20.0


    try:
        humidity = float(props.get("umezeala", 50))
    except (TypeError, ValueError):
        humidity = 50.0


    vant = props.get("vant", "")
    wind_speed = _parse_wind_speed(vant)
    wind_direction = _parse_wind_direction(vant)


    visibility_km = {
        "clear": 10.0,
        "cloudy": 10.0,
        "light_rain": 7.0,
        "rain": 4.0,
        "heavy_rain": 2.0,
        "fog": 0.5,
        "snow": 3.0,
        "storm": 1.0,
    }.get(condition, 10.0)


    station_name = props.get("nume", "")
    description = f"{nebulozitate}"
    if fenomen_e and fenomen_e != "indisponibil":
        description += f", {fenomen_e}"

    return {
        "condition": condition,
        "temperature": temperature,
        "humidity": humidity,
        "wind_speed": wind_speed,
        "wind_direction": wind_direction,
        "visibility_km": visibility_km,
        "api_description": f"{station_name}: {description}",
    }


def _update_zone_from_features(zone: WeatherZone, features: List[dict]) -> bool:
    """
    Updates a zone with the nearest ANM station data.
    Returns True if update succeeded.
    """

    target_name = ZONE_STATIONS.get(zone.name)
    matched_props = None
    if target_name:
        for props in features:
            if props.get("nume", "").upper() == target_name.upper():
                matched_props = props
                break


    if matched_props is None:
        matched_props = _find_nearest_station(zone.center_lat, zone.center_lon, features)

    if matched_props is None:
        return False

    parsed = _props_to_zone_data(matched_props)
    zone.condition = parsed["condition"]
    zone.temperature = parsed["temperature"]
    zone.humidity = parsed["humidity"]
    zone.wind_speed = parsed["wind_speed"]
    zone.wind_direction = parsed["wind_direction"]
    zone.visibility_km = parsed["visibility_km"]
    zone.api_description = parsed["api_description"]
    zone.last_update = time.time()
    return True


def _initialize_zones() -> None:
    """Initializes zones with real data from the ANM API."""
    global _anm_features_cache
    print("[Weather] Fetching real weather data from Meteoromania (ANM)...")
    features = _fetch_anm_data()

    if features is None or len(features) == 0:
        print("[Weather] ⚠️  Could not fetch ANM data — using default values.")
        for zone in WEATHER_ZONES:
            zone.condition = "clear"
            zone.temperature = 20.0
            zone.wind_speed = 5.0
            zone.wind_direction = "N"
            zone.humidity = 50.0
            zone.visibility_km = 10.0
            zone.last_update = time.time()
        return

    _anm_features_cache = features
    success_count = 0
    for zone in WEATHER_ZONES:
        ok = _update_zone_from_features(zone, features)
        if ok:
            success_count += 1
            meta = WEATHER_TYPES.get(zone.condition, {})
            print(
                f"  ✓ {zone.name}: {meta.get('icon', '')} {zone.api_description} "
                f"({zone.temperature:.1f}°C, wind {zone.wind_speed:.0f} km/h)"
            )
        else:
            zone.last_update = time.time()

    print(f"[Weather] {success_count}/{len(WEATHER_ZONES)} zones updated from ANM API.")


def get_all_weather() -> List[dict]:
    """Returns weather conditions for all zones, applying active demo scenario overrides."""
    with _weather_lock:
        now_ts = time.time()
        results = []
        for zone in WEATHER_ZONES:
            override = _scenario_overrides.get(zone.name)
            if override and override["expires_at"] > now_ts:
                condition_override = override["condition"]
                saved = zone.condition
                zone.condition = condition_override
                results.append(zone.to_dict())
                zone.condition = saved
            else:
                if override:
                    _scenario_overrides.pop(zone.name, None)
                results.append(zone.to_dict())
        return results


def get_weather_at(lat: float, lon: float) -> dict:
    """
    Returns weather conditions at a specific location.
    Finds the nearest weather zone.
    """
    with _weather_lock:
        best_zone = None
        best_dist = float("inf")

        for zone in WEATHER_ZONES:
            from backend.services.grid import haversine_distance
            dist = haversine_distance(lat, lon, zone.center_lat, zone.center_lon)
            if dist < best_dist:
                best_dist = dist
                best_zone = zone

        if best_zone is None:
            return {
                "condition": "clear",
                "condition_label": "Clear",
                "condition_icon": "☀️",
                "severity": 0,
                "temperature": 20.0,
                "wind_speed": 5.0,
                "wind_direction": "N",
                "humidity": 50.0,
                "visibility_km": 10.0,
                "speed_multiplier": 1.0,
                "battery_multiplier": 1.0,
                "can_fly": True,
                "warning": None,
                "zone_name": "Unknown",
                "distance_to_zone_km": 0,
                "source": "meteoromania",
            }


        now_ts = time.time()
        global_override = _scenario_overrides.get("GLOBAL")
        is_global_active = global_override and global_override["expires_at"] > now_ts


        if not is_global_active and best_dist > best_zone.radius_km:
            import math

            geo_wind = 5.0 + 10.0 * abs(math.sin(lat * 15.0) * math.cos(lon * 15.0))

            geo_temp = 20.0 + 2.5 * math.sin(lat * 8.0)
            

            impact = compute_weather_impact("clear", geo_wind, geo_temp)
            
            return {
                "condition": "clear",
                "condition_label": "Clear",
                "condition_icon": "☀️",
                "severity": 0,
                "temperature": round(geo_temp, 1),
                "wind_speed": round(geo_wind, 1),
                "wind_direction": "N",
                "humidity": 50.0,
                "visibility_km": 10.0,
                "speed_multiplier": round(impact["speed_multiplier"], 2),
                "battery_multiplier": round(impact["battery_multiplier"], 2),
                "can_fly": True,
                "warning": impact["warning"],
                "zone_name": best_zone.name,
                "distance_to_zone_km": round(best_dist, 1),
                "source": "meteoromania",
            }

        result = best_zone.to_dict()


        if is_global_active:
            override = global_override
        else:
            override = _scenario_overrides.get(best_zone.name)

        if override and override["expires_at"] > now_ts:
            condition_override = override["condition"]
            saved = best_zone.condition
            best_zone.condition = condition_override
            result = best_zone.to_dict()
            best_zone.condition = saved
        else:
            if override and not is_global_active:
                _scenario_overrides.pop(best_zone.name, None)


        try:
            import math

            local_wind_var = 3.5 * math.sin(lat * 45.0) * math.cos(lon * 45.0)

            local_temp_var = 1.5 * math.sin(lat * 25.0)
            
            adjusted_wind = max(0.0, result.get("wind_speed", 0.0) + local_wind_var)
            adjusted_temp = result.get("temperature", 20.0) + local_temp_var
            

            impact = compute_weather_impact(result["condition"], adjusted_wind, adjusted_temp)
            
            result["wind_speed"] = round(adjusted_wind, 1)
            result["temperature"] = round(adjusted_temp, 1)
            result["speed_multiplier"] = round(impact["speed_multiplier"], 2)
            result["battery_multiplier"] = round(impact["battery_multiplier"], 2)
            result["can_fly"] = impact["can_fly"]
            result["warning"] = impact["warning"] or result.get("warning")
        except Exception:
            pass

        result["zone_name"] = best_zone.name
        result["distance_to_zone_km"] = round(best_dist, 1)
        return result


def get_weather_impact_at(lat: float, lon: float) -> dict:
    """
    Returns only impact multipliers at a location.
    Used by the simulator for efficiency.
    """
    weather = get_weather_at(lat, lon)
    return {
        "speed_multiplier": weather["speed_multiplier"],
        "battery_multiplier": weather["battery_multiplier"],
        "can_fly": weather["can_fly"],
        "condition": weather["condition"],
        "wind_speed": weather.get("wind_speed", 0),
        "warning": weather["warning"],
        "zone_name": weather.get("zone_name"),
        "distance_to_zone_km": weather.get("distance_to_zone_km"),
    }


def _interpolate_points(lat1, lon1, lat2, lon2, max_step_km=10.0):
    """
    Generates intermediate points between two coordinates.
    max_step_km = approximate maximum distance between weather checks.
    """
    from backend.services.grid import haversine_distance
    distance_km = haversine_distance(
        float(lat1), float(lon1),
        float(lat2), float(lon2),
    )

    steps = max(1, int(math.ceil(distance_km / max_step_km)))
    points = []

    for i in range(steps + 1):
        t = i / steps
        lat = float(lat1) + (float(lat2) - float(lat1)) * t
        lon = float(lon1) + (float(lon2) - float(lon1)) * t
        points.append([lat, lon])

    return points


MAX_WEATHER_CHECK_POINTS = 80

def check_weather_safety_on_route(route_path: list, max_step_km: float = 20.0) -> dict:
    """
    Checks weather conditions along the entire route, including segments between waypoints.
    Optimized: caps the total number of check points to 80 to ensure stable performance.
    """
    if not route_path or len(route_path) < 2:
        return {
            "safe": True,
            "reason": None,
            "critical_points": [],
            "weather_penalty": 0.0,
            "checked_points_count": 0,
        }

    checked_points = []


    for i in range(len(route_path) - 1):
        start = route_path[i]
        end = route_path[i + 1]

        segment_points = _interpolate_points(
            start[0], start[1],
            end[0], end[1],
            max_step_km=max_step_km,
        )


        if i > 0:
            segment_points = segment_points[1:]

        checked_points.extend(segment_points)


    if len(checked_points) > MAX_WEATHER_CHECK_POINTS:
        step = max(1, len(checked_points) // MAX_WEATHER_CHECK_POINTS)
        checked_points = checked_points[::step]
        

        last_pt = [float(route_path[-1][0]), float(route_path[-1][1])]
        if checked_points[-1] != last_pt:
            checked_points.append(last_pt)

    critical_points = []
    weather_penalty = 0.0


    for point in checked_points:
        lat = float(point[0])
        lon = float(point[1])

        impact = get_weather_impact_at(lat, lon)
        
        condition = impact.get("condition", "clear")
        wind_speed = float(impact.get("wind_speed", 0) or 0)
        battery_mult = float(impact.get("battery_multiplier", 1.0) or 1.0)

        from backend.services.settings_service import get_settings
        settings = get_settings()
        max_wind = settings.get("max_wind", 45.0)


        if impact.get("can_fly") is False or condition == "storm" or wind_speed >= max_wind:
            critical_points.append({
                "lat": lat,
                "lon": lon,
                "warning": impact.get("warning", "Unfavorable weather conditions"),
            })


        point_weight = 1.0
        if len(checked_points) > 1:

            point_weight = 80.0 / len(checked_points)
            
        weather_penalty += max(0.0, battery_mult - 1.0) * 10.0 * point_weight

    if critical_points:
        return {
            "safe": False,
            "reason": "Route crosses areas with unsafe weather conditions.",
            "critical_points": critical_points,
            "weather_penalty": round(weather_penalty, 2),
            "checked_points_count": len(checked_points),
        }

    return {
        "safe": True,
        "reason": None,
        "critical_points": [],
        "weather_penalty": round(weather_penalty, 2),
        "checked_points_count": len(checked_points),
    }


_running = False


def _weather_loop():
    """Main loop — updates all zones from the ANM API every UPDATE_INTERVAL_SEC."""
    global _running, _anm_features_cache
    _running = True
    

    _initialize_zones()
    
    while _running:
        try:
            time.sleep(UPDATE_INTERVAL_SEC)
            features = _fetch_anm_data()
            if features:
                _anm_features_cache = features
                with _weather_lock:
                    for zone in WEATHER_ZONES:
                        _update_zone_from_features(zone, features)
                _broadcast_weather_update()
                print(f"[Weather] Scheduled ANM zones update at {time.strftime('%H:%M:%S')}")
            else:
                print("[Weather] Scheduled ANM update failed — keeping previous data.")
        except Exception as e:
            print(f"[Weather] Update error: {e}")


def _broadcast_weather_update():
    """Sends weather update via WebSocket + updates conditions for active drones."""
    try:
        from backend.routes.ws import manager
        if not manager or not manager.active_connections:
            return

        weather_data = get_all_weather()
        manager.queue_broadcast({
            "type": "weather_update",
            "zones": weather_data,
        })

        try:
            from backend.database import SessionLocal
            from backend.models.drone import Drone
            db = SessionLocal()
            active_drones = db.query(Drone).filter(
                Drone.status.in_(["in_mission", "going_to_charging"])
            ).all()
            for drone in active_drones:
                if drone.latitude is not None and drone.longitude is not None:
                    w = get_weather_at(float(drone.latitude), float(drone.longitude))
                    manager.queue_broadcast({
                        "type": "drone_weather_update",
                        "drone_id": drone.id,
                        "weather": {
                            "condition": w.get("condition", "clear"),
                            "condition_label": w.get("condition_label", "Clear"),
                            "condition_icon": w.get("condition_icon", "☀️"),
                            "temperature": w.get("temperature", 20.0),
                            "wind_speed": w.get("wind_speed", 0),
                            "wind_direction": w.get("wind_direction", "N"),
                            "humidity": w.get("humidity", 50),
                            "visibility_km": w.get("visibility_km", 10),
                            "speed_multiplier": round(w.get("speed_multiplier", 1.0), 2),
                            "battery_multiplier": round(w.get("battery_multiplier", 1.0), 2),
                            "can_fly": w.get("can_fly", True),
                            "warning": w.get("warning"),
                            "zone_name": w.get("zone_name", ""),
                            "api_description": w.get("api_description", ""),
                            "source": w.get("source", "meteoromania"),
                        },
                    })
            db.close()
        except Exception as e:
            print(f"[Weather] Error broadcasting drone weather: {e}")
    except Exception:
        pass


def start_weather_service():
    """Starts the weather service with real ANM data in the background."""
    thread = threading.Thread(target=_weather_loop, daemon=True)
    thread.start()
    print(
        f"[Weather] Weather service started — source: Meteoromania (ANM), "
        f"update every {UPDATE_INTERVAL_SEC}s."
    )


def stop_weather_service():
    """Stops the weather service."""
    global _running
    _running = False
