import asyncio
from fastapi import APIRouter, Query
from backend.services.geocoding import geocode_address, reverse_geocode, reverse_geocode_local
from backend.schemas.geocoding import GeocodeResponse

router = APIRouter(prefix="/geocoding", tags=["Geocoding"])

@router.get("/search", response_model=GeocodeResponse)
def search_address(q: str = Query(..., description="Address to search for")):
    """
    Searches for coordinates for a text address using the internal service (Nominatim).
    FastAPI automatically runs sync endpoints in a thread pool.
    """
    try:
        lat, lon = geocode_address(q)
        if lat is None:
            return GeocodeResponse(lat=None, lon=None, address=q, success=False, error="Address not found")
        return GeocodeResponse(lat=lat, lon=lon, address=q, success=True)
    except Exception as e:
        return GeocodeResponse(lat=None, lon=None, address=q, success=False, error=str(e))


@router.get("/reverse", response_model=GeocodeResponse)
def reverse_address(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
):
    """
    Resolves a human-readable address for a coordinate pair.
    Uses instant local city lookup first; falls back to Nominatim only if needed.
    FastAPI automatically runs sync endpoints in a thread pool.
    """

    local_address = reverse_geocode_local(lat, lon)
    if local_address:
        return GeocodeResponse(lat=lat, lon=lon, address=local_address, success=True)


    try:
        address = reverse_geocode(lat, lon)
        if address is None:
            return GeocodeResponse(lat=lat, lon=lon, address="", success=False, error="Address not found")
        return GeocodeResponse(lat=lat, lon=lon, address=address, success=True)
    except Exception as e:
        return GeocodeResponse(lat=lat, lon=lon, address="", success=False, error=str(e))
