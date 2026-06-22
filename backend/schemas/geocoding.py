from pydantic import BaseModel
from typing import Optional

class GeocodeResponse(BaseModel):
    lat: Optional[float]
    lon: Optional[float]
    address: str
    success: bool
    error: Optional[str] = None
