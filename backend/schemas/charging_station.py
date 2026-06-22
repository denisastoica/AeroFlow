from pydantic import BaseModel, ConfigDict, Field

class ChargingStationBase(BaseModel):
    name: str = Field(..., json_schema_extra={"example": "Cluj-Napoca Center"})
    latitude: float = Field(..., json_schema_extra={"example": 46.7712})
    longitude: float = Field(..., json_schema_extra={"example": 23.6236})
    active: bool = True

class ChargingStationCreate(ChargingStationBase):
    pass

class ChargingStationUpdate(BaseModel):
    name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    active: bool | None = None

class ChargingStationOut(ChargingStationBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
