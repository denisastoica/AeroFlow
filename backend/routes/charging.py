"""API for charging stations."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException

from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models.charging_station import ChargingStation
from backend.schemas.charging_station import ChargingStationCreate, ChargingStationOut, ChargingStationUpdate
from backend.services.charging_stations import MAX_AUTONOMY_KM, seed_and_load_stations
from backend.services.auth_dependencies import require_role

router = APIRouter(prefix="/charging", tags=["Charging Stations"])

@router.get("/stations", response_model=dict)
def list_stations(db: Session = Depends(get_db)):
    """Lists all active and inactive charging stations and the maximum autonomy."""
    stations = db.query(ChargingStation).all()
    
    return {
        "stations": [{"id": s.id, "name": s.name, "lat": s.latitude, "lon": s.longitude, "active": s.active} for s in stations],
        "max_autonomy_km": MAX_AUTONOMY_KM,
    }

@router.post("/stations", response_model=ChargingStationOut, dependencies=[Depends(require_role("admin", "dispatcher"))])
def create_station(station_in: ChargingStationCreate, db: Session = Depends(get_db)):
    db_station = ChargingStation(**station_in.model_dump())
    db.add(db_station)
    db.commit()
    db.refresh(db_station)
    seed_and_load_stations(db)
    return db_station

@router.put("/stations/{station_id}", response_model=ChargingStationOut, dependencies=[Depends(require_role("admin", "dispatcher"))])
def update_station(station_id: int, station_in: ChargingStationUpdate, db: Session = Depends(get_db)):
    db_station = db.query(ChargingStation).filter(ChargingStation.id == station_id).first()
    if not db_station:
        raise HTTPException(status_code=404, detail="Station not found")
    
    update_data = station_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_station, key, value)
    
    db.commit()
    db.refresh(db_station)
    seed_and_load_stations(db)
    return db_station

@router.delete("/stations/{station_id}", dependencies=[Depends(require_role("admin", "dispatcher"))])
def delete_station(station_id: int, db: Session = Depends(get_db)):
    db_station = db.query(ChargingStation).filter(ChargingStation.id == station_id).first()
    if not db_station:
        raise HTTPException(status_code=404, detail="Station not found")
    
    db.delete(db_station)
    db.commit()
    seed_and_load_stations(db)
    return {"detail": "Station deleted"}
