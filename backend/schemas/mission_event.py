from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional


class MissionEventBase(BaseModel):
    mission_id: int
    event_type: str
    details: Optional[str] = None


class MissionEventCreate(MissionEventBase):
    pass


class MissionEventResponse(MissionEventBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    timestamp: datetime
