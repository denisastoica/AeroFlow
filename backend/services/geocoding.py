"""
Geocoding service — address to GPS coordinates conversion.
Uses Nominatim (OpenStreetMap) as primary, Photon as fallback.
Has a built-in cache of major Romanian cities for offline/rate-limit resilience.
"""
from typing import Optional, Tuple
import unicodedata
import requests
from fastapi import HTTPException
from backend.services.geo_locations import CITY_COORDS


_RO_CITIES: dict[str, Tuple[float, float]] = {

    "bucuresti":        CITY_COORDS["Bucharest"],
    "bucharest":        CITY_COORDS["Bucharest"],
    "cluj-napoca":      CITY_COORDS["Cluj-Napoca"],
    "cluj napoca":      CITY_COORDS["Cluj-Napoca"],
    "cluj":             CITY_COORDS["Cluj-Napoca"],
    "timisoara":        CITY_COORDS["Timisoara"],
    "timișoara":        CITY_COORDS["Timisoara"],
    "iasi":             CITY_COORDS["Iasi"],
    "iași":             CITY_COORDS["Iasi"],
    "constanta":        CITY_COORDS["Constanta"],
    "constanța":        CITY_COORDS["Constanta"],
    "craiova":          CITY_COORDS["Craiova"],
    "brasov":           CITY_COORDS["Brasov"],
    "brașov":           CITY_COORDS["Brasov"],
    "galati":           CITY_COORDS["Galati"],
    "galați":           CITY_COORDS["Galati"],
    "ploiesti":         CITY_COORDS["Ploiesti"],
    "ploiești":         CITY_COORDS["Ploiesti"],
    "oradea":           CITY_COORDS["Oradea"],
    "braila":           (45.2692, 27.9574),
    "brăila":           (45.2692, 27.9574),
    "arad":             CITY_COORDS["Arad"],
    "pitesti":          (44.8565, 24.8691),
    "pitești":          (44.8565, 24.8691),
    "sibiu":            CITY_COORDS["Sibiu"],
    "bacau":            CITY_COORDS["Bacau"],
    "bacău":            CITY_COORDS["Bacau"],
    "targu mures":      CITY_COORDS["Targu Mures"],
    "târgu mureș":      CITY_COORDS["Targu Mures"],
    "targu-mures":      CITY_COORDS["Targu Mures"],
    "baia mare":        CITY_COORDS["Baia Mare"],
    "buzau":            (45.1500, 26.8300),
    "buzău":            (45.1500, 26.8300),
    "satu mare":        (47.7925, 22.8851),
    "botosani":         (47.7452, 26.6693),
    "botoșani":         (47.7452, 26.6693),
    "ramnicu valcea":   (45.1046, 24.3693),
    "râmnicu vâlcea":   (45.1046, 24.3693),
    "drobeta-turnu severin": (44.6256, 22.6564),
    "suceava":          CITY_COORDS["Suceava"],
    "piatra neamt":     CITY_COORDS["Piatra Neamt"],
    "piatra neamț":     CITY_COORDS["Piatra Neamt"],
    "targoviste":       (44.9333, 25.4581),
    "târgoviște":       (44.9333, 25.4581),
    "deva":             (45.8833, 22.9000),
    "focsani":          (45.6967, 27.1878),
    "focșani":          (45.6967, 27.1878),
    "bistrita":         CITY_COORDS["Bistrita"],
    "bistrița":         CITY_COORDS["Bistrita"],
    "resia":            (45.3000, 21.8833),
    "resita":           (45.3000, 21.8833),
    "alba iulia":       CITY_COORDS["Alba Iulia"],
    "alba-iulia":       CITY_COORDS["Alba Iulia"],
    "giurgiu":          (43.9000, 25.9667),
    "dej":              (47.1500, 23.8667),
    "hunedoara":        (45.7456, 22.9017),
    "turda":            (46.5833, 23.7833),
    "roman":            (46.9167, 26.9333),
    "medias":           (46.1558, 24.3536),
    "mediaș":           (46.1558, 24.3536),
    "onesti":           (46.2456, 26.7768),
    "onești":           (46.2456, 26.7768),
    "miercurea ciuc":   (46.3600, 25.8000),
    "miercurea-ciuc":   (46.3600, 25.8000),
    "sfantu gheorghe":  (45.8667, 25.7833),
    "sfântu gheorghe":  (45.8667, 25.7833),
    "alexandria":       (43.9667, 25.3333),
    "slobozia":         (44.5600, 27.3700),
    "calarasi":         (44.2000, 27.3333),
    "călărași":         (44.2000, 27.3333),
    "tulcea":           (45.1833, 28.8000),
    "vaslui":           (46.6400, 27.7300),
    "zalau":            (47.1833, 23.0500),
    "zalău":            (47.1833, 23.0500),
    "lugoj":            (45.6881, 21.9028),
    "tecuci":           (45.8500, 27.4333),
    "campina":          (45.1267, 25.7444),
    "câmpina":          (45.1267, 25.7444),
    "campulung":        (45.2667, 25.0500),
    "curtea de arges":  (45.1333, 24.6833),
    "huedin":           (46.8800, 22.8600),
    "fetesti":          (44.3700, 27.8300),
    "fetești":          (44.3700, 27.8300),
}


def _normalize(text: str) -> str:
    """Lowercase, strip diacritics, collapse whitespace."""
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_text = "".join(c for c in nfkd if not unicodedata.combining(c))
    return " ".join(ascii_text.lower().split())


def _lookup_city_cache_exact(address: str) -> Optional[Tuple[float, float]]:
    """Checks the built-in Romanian city dictionary for an exact match."""
    norm = _normalize(address)
    if norm in _RO_CITIES:
        return _RO_CITIES[norm]
    return None


def _lookup_city_cache_fuzzy(address: str) -> Optional[Tuple[float, float]]:
    """
    Checks if any city name appears at the start of or inside the query.
    Used as a fallback when external APIs fail, returning the city center.
    """
    norm = _normalize(address)

    for city_key, coords in sorted(_RO_CITIES.items(), key=lambda x: -len(x[0])):
        if norm.startswith(city_key):
            return coords


    for city_key, coords in sorted(_RO_CITIES.items(), key=lambda x: -len(x[0])):
        if city_key in norm:
            return coords

    return None


def _try_nominatim(address: str) -> Optional[Tuple[float, float]]:
    """Try Nominatim, restricting results to Romania."""
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "q": address,
        "format": "json",
        "countrycodes": "ro",
        "limit": 5,
        "accept-language": "ro,en",
    }
    headers = {"User-Agent": "AeroFlow-DroneDelivery/1.0 (university-project)"}
    try:
        r = requests.get(url, params=params, headers=headers, timeout=3)
        if r.status_code != 200:
            return None
        data = r.json()
        if data:
            return float(data[0]["lat"]), float(data[0]["lon"])

        params_wide = {"q": address + ", Romania", "format": "json", "limit": 3}
        r2 = requests.get(url, params=params_wide, headers=headers, timeout=3)
        if r2.status_code == 200:
            data2 = r2.json()
            if data2:
                return float(data2[0]["lat"]), float(data2[0]["lon"])
    except Exception:
        pass
    return None


def _try_photon(address: str) -> Optional[Tuple[float, float]]:
    """Try Photon (Komoot) as a fallback geocoder, filtered to Romania bbox."""
    url = "https://photon.komoot.io/api/"
    params = {
        "q": address + " Romania",
        "limit": 5,
        "bbox": "20.2,43.5,30.0,48.3",
    }
    headers = {"User-Agent": "AeroFlow-DroneDelivery/1.0"}
    try:
        r = requests.get(url, params=params, headers=headers, timeout=3)
        if r.status_code != 200:
            return None
        data = r.json()
        features = data.get("features", [])

        for f in features:
            coords = f.get("geometry", {}).get("coordinates", [])
            if len(coords) >= 2:
                lon, lat = float(coords[0]), float(coords[1])
                if 20.2 <= lon <= 30.0 and 43.5 <= lat <= 48.3:
                    return lat, lon
    except Exception:
        pass
    return None


def geocode_address(address: str) -> Tuple[Optional[float], Optional[float]]:
    """
    Returns (latitude, longitude) for a text address.

    Resolution order:
    1. Exact local cache (instant, no network) - e.g. "Bucuresti"
    2. Nominatim (OpenStreetMap), restricted to Romania
    3. Photon (Komoot) as fallback
    4. Fuzzy local cache (returns city center if street-level fails)
    """
    if not address or not address.strip():
        return None, None


    cached_exact = _lookup_city_cache_exact(address)
    if cached_exact:
        return cached_exact


    result = _try_nominatim(address)
    if result:
        return result


    result = _try_photon(address)
    if result:
        return result


    cached_fuzzy = _lookup_city_cache_fuzzy(address)
    if cached_fuzzy:
        return cached_fuzzy

    return None, None


def reverse_geocode_local(lat: float, lon: float) -> Optional[str]:
    """
    Fast reverse geocoding using the local Romanian city database.
    Returns the nearest city name with no network calls (instant).
    Used as a primary lookup to avoid slow external API calls.
    """
    best_dist_sq = float("inf")
    best_city: Optional[str] = None

    for city_name, (city_lat, city_lon) in CITY_COORDS.items():
        dist_sq = (lat - city_lat) ** 2 + (lon - city_lon) ** 2
        if dist_sq < best_dist_sq:
            best_dist_sq = dist_sq
            best_city = city_name

    if best_city:


        if best_dist_sq < 0.04:
            return f"{best_city}, Romania"
        return f"Zona {best_city}, Romania"
    return None


def reverse_geocode(lat: float, lon: float) -> Optional[str]:
    """
    Returns a human-readable address for a coordinate pair.
    Raises HTTPException 502/504 if the external service fails.
    Returns None if the address is not found.
    """
    url = "https://nominatim.openstreetmap.org/reverse"
    params = {"lat": lat, "lon": lon, "format": "jsonv2"}
    headers = {"User-Agent": "AeroFlow-DroneDelivery/1.0 (university-project)"}
    try:
        response = requests.get(url, params=params, headers=headers, timeout=3)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Geocoding service timed out")
    except requests.exceptions.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Geocoding service error: {exc}")

    return data.get("display_name")
