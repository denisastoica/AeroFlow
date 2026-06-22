from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime

from backend.database import get_db
from backend.models.mission import Mission
from backend.models.delivery import Delivery
from backend.models.mission_event import MissionEvent
from backend.models.drone import Drone
from backend.models.user import User
from backend.schemas.mission import MissionResponse, PaginatedMissionsResponse
from backend.schemas.mission_event import MissionEventResponse
from backend.services.mission_service import get_all_missions, mission_stats, build_mission_eta, fail_mission, abort_mission
from backend.services.mission_event_service import get_events_for_mission, log_event
from backend.services.auth_service import Role
from backend.services.auth_dependencies import (
    get_current_user,
    require_role,
)
from backend.services.audit_service import log_mission_action
from backend.models.audit_log import AuditAction
from backend.services.routing_utils import plan_route_leg

router = APIRouter(prefix="/missions", tags=["missions"])


class FailReasonRequest(BaseModel):
    reason: str


def _get_customer_mission_ids(db: Session, user_id: int) -> set:
    """IDs of missions linked to this customer's deliveries."""
    delivery_ids = [
        d.id for d in db.query(Delivery.id).filter(Delivery.customer_id == user_id).all()
    ]
    if not delivery_ids:
        return set()
    return {
        m.id for m in db.query(Mission.id).filter(Mission.delivery_id.in_(delivery_ids)).all()
    }


@router.get("/", response_model=PaginatedMissionsResponse)
def list_missions(
    status: str = Query(None, description="Mission status filter (or comma-separated list)"),
    drone_id: int = Query(None, description="Filter by drone"),
    delivery_id: int = Query(None, description="Filter by delivery"),
    date_from: datetime = Query(None, description="Start date >= (ISO format)"),
    date_to: datetime = Query(None, description="Start date <= (ISO format)"),
    active_only: bool = Query(False, description="Only active missions (no end_time)"),
    sort_by: str = Query("start_time", description="Sort field: start_time, end_time, progress_pct"),
    sort_order: str = Query("desc", description="Order: asc or desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Lists missions with filters and pagination.
    
    Available filters:
    - status: en_route_pickup, at_pickup, en_route_delivery, delivered, failed, etc.
    - drone_id: Drone ID
    - delivery_id: Delivery ID
    - date_from/date_to: Start time interval
    - active_only: Only missions in progress
    """
    query = db.query(Mission)
    

    if current_user.role == Role.CUSTOMER.value:
        allowed_ids = _get_customer_mission_ids(db, current_user.id)
        query = query.filter(Mission.id.in_(allowed_ids))
    elif current_user.role not in (Role.ADMIN.value, Role.DISPATCHER.value):
        raise HTTPException(status_code=403, detail="Access denied")
    

    if status:
        statuses = [s.strip() for s in status.split(",")]
        query = query.filter(Mission.status.in_(statuses))
    

    if drone_id:
        query = query.filter(Mission.drone_id == drone_id)
    

    if delivery_id:
        query = query.filter(Mission.delivery_id == delivery_id)
    

    if date_from:
        query = query.filter(Mission.start_time >= date_from)
    if date_to:
        query = query.filter(Mission.start_time <= date_to)
    

    if active_only:
        query = query.filter(Mission.end_time == None)
    

    total = query.count()
    

    sort_column = getattr(Mission, sort_by, Mission.start_time)
    if sort_order.lower() == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())
    

    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    offset = (page - 1) * page_size
    missions = query.offset(offset).limit(page_size).all()
    
    import json
    enriched_missions = []
    for m in missions:
        base = {c.name: getattr(m, c.name) for c in m.__table__.columns}
        

        if m.delivery:
            base["pickup_lat"] = m.delivery.pickup_lat
            base["pickup_lon"] = m.delivery.pickup_lon
            base["dest_lat"] = m.delivery.dest_lat
            base["dest_lon"] = m.delivery.dest_lon


        if m.drone:
            base["drone_lat"] = m.drone.latitude
            base["drone_lon"] = m.drone.longitude
            base["drone_battery"] = m.drone.battery
            base["route_index"] = m.drone.route_index
            

            from backend.services.weather_service import get_weather_impact_at
            _speed_mult = 1.0
            if m.drone.latitude is not None and m.drone.longitude is not None:
                try:
                    _wx = get_weather_impact_at(float(m.drone.latitude), float(m.drone.longitude))
                    _speed_mult = max(0.1, _wx.get("speed_multiplier", 1.0))
                except Exception:
                    pass
            
            from backend.services.battery_service import compute_effective_speed
            drone_weight = float(m.drone.weight_kg) if m.drone.weight_kg is not None else 3.5
            payload_weight = float(m.delivery.weight_kg) if (m.delivery and m.delivery.weight_kg is not None) else 0.0
            
            base["drone_speed"] = compute_effective_speed(
                weight_kg=drone_weight + payload_weight,
                weather_speed_mult=_speed_mult
            ) if m.drone.status in ("in_mission", "going_to_charging") else 0.0
            
            try:
                base["route_path"] = json.loads(m.drone.route_path) if isinstance(m.drone.route_path, str) else m.drone.route_path
            except:
                base["route_path"] = m.drone.route_path

            mission_planned = m.planned_route_path
            if isinstance(mission_planned, str):
                try:
                    mission_planned = json.loads(mission_planned)
                except Exception:
                    pass

            drone_planned = m.drone.planned_route_path
            if isinstance(drone_planned, str):
                try:
                    drone_planned = json.loads(drone_planned)
                except Exception:
                    pass

            base["planned_route_path"] = mission_planned or drone_planned
                
        enriched_missions.append(base)

    return PaginatedMissionsResponse(
        items=enriched_missions,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        has_next=page < total_pages,
        has_prev=page > 1,
    )


@router.get("/history", response_model=PaginatedMissionsResponse)
def list_mission_history(
    drone_id: int = Query(None, description="Filter by drone"),
    status: str = Query(None, description="Final status filter: delivered, failed, aborted"),
    date_from: datetime = Query(None, description="Completion date >= (ISO format)"),
    date_to: datetime = Query(None, description="Completion date <= (ISO format)"),
    min_distance_km: float = Query(None, description="Minimum distance covered"),
    sort_by: str = Query("end_time", description="Sort field"),
    sort_order: str = Query("desc", description="Order: asc or desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Completed mission history.
    Returns only missions with end_time set.
    Optimized for reports and analysis.
    """
    query = db.query(Mission).filter(Mission.end_time != None)
    

    if current_user.role == Role.CUSTOMER.value:
        allowed_ids = _get_customer_mission_ids(db, current_user.id)
        query = query.filter(Mission.id.in_(allowed_ids))
    elif current_user.role not in (Role.ADMIN.value, Role.DISPATCHER.value):
        raise HTTPException(status_code=403, detail="Access denied")
    

    if drone_id:
        query = query.filter(Mission.drone_id == drone_id)
    if status:
        statuses = [s.strip() for s in status.split(",")]
        query = query.filter(Mission.status.in_(statuses))
    if date_from:
        query = query.filter(Mission.end_time >= date_from)
    if date_to:
        query = query.filter(Mission.end_time <= date_to)
    if min_distance_km:
        query = query.filter(Mission.total_distance_km >= min_distance_km)
    

    total = query.count()
    

    sort_column = getattr(Mission, sort_by, Mission.end_time)
    if sort_order.lower() == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())
    

    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    offset = (page - 1) * page_size
    missions = query.offset(offset).limit(page_size).all()
    
    import json
    enriched_missions = []
    for m in missions:
        base = {c.name: getattr(m, c.name) for c in m.__table__.columns}
        

        if m.delivery:
            base["pickup_lat"] = m.delivery.pickup_lat
            base["pickup_lon"] = m.delivery.pickup_lon
            base["dest_lat"] = m.delivery.dest_lat
            base["dest_lon"] = m.delivery.dest_lon


        if m.drone:
            base["drone_lat"] = m.drone.latitude
            base["drone_lon"] = m.drone.longitude
            base["drone_battery"] = m.drone.battery
            base["route_index"] = m.drone.route_index
            

            from backend.services.weather_service import get_weather_impact_at
            _speed_mult = 1.0
            if m.drone.latitude is not None and m.drone.longitude is not None:
                try:
                    _wx = get_weather_impact_at(float(m.drone.latitude), float(m.drone.longitude))
                    _speed_mult = max(0.1, _wx.get("speed_multiplier", 1.0))
                except Exception:
                    pass
            
            from backend.services.battery_service import compute_effective_speed
            drone_weight = float(m.drone.weight_kg) if m.drone.weight_kg is not None else 3.5
            payload_weight = float(m.delivery.weight_kg) if (m.delivery and m.delivery.weight_kg is not None) else 0.0
            
            base["drone_speed"] = compute_effective_speed(
                weight_kg=drone_weight + payload_weight,
                weather_speed_mult=_speed_mult
            ) if m.drone.status in ("in_mission", "going_to_charging") else 0.0
            
            try:
                base["route_path"] = json.loads(m.drone.route_path) if isinstance(m.drone.route_path, str) else m.drone.route_path
            except:
                base["route_path"] = m.drone.route_path

            mission_planned = m.planned_route_path
            if isinstance(mission_planned, str):
                try:
                    mission_planned = json.loads(mission_planned)
                except Exception:
                    pass

            drone_planned = m.drone.planned_route_path
            if isinstance(drone_planned, str):
                try:
                    drone_planned = json.loads(drone_planned)
                except Exception:
                    pass

            base["planned_route_path"] = mission_planned or drone_planned
                
        enriched_missions.append(base)

    return PaginatedMissionsResponse(
        items=enriched_missions,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        has_next=page < total_pages,
        has_prev=page > 1,
    )


@router.get("/stats")
def missions_stats(
    current_user: User = Depends(get_current_user),
    _: dict = Depends(require_role("admin", "dispatcher")),
    db: Session = Depends(get_db),
):
    """
    Returns statistics about missions.
    Accessible: admin, dispatcher.
    """
    stats = mission_stats(db)
    return stats


@router.get("/{mission_id}/events", response_model=list[MissionEventResponse])
def list_mission_events(
    mission_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns events for a mission.
    Admin/dispatcher: any mission.
    Customer: only their own.
    """
    if current_user.role == Role.CUSTOMER.value:
        allowed_ids = _get_customer_mission_ids(db, current_user.id)
        if mission_id not in allowed_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this mission")

    events = get_events_for_mission(db, mission_id)
    return events


@router.get("/{mission_id}/progress")
def get_mission_progress(
    mission_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns ETA and detailed progress per segment for an active mission.
    Fields returned:
    - overall_progress_pct, pickup_leg_progress_pct, dest_leg_progress_pct
    - remaining_km, remaining_km_to_pickup, remaining_km_to_destination
    - eta_sim_s_to_pickup, eta_sim_s_to_destination (simulation time)
    - eta_real_h_to_pickup, eta_real_h_to_destination (real-world estimate)
    - phase_label (current phase description)
    Admin/dispatcher: any mission. Customer: only their own.
    """
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    if current_user.role == Role.CUSTOMER.value:
        allowed_ids = _get_customer_mission_ids(db, current_user.id)
        if mission_id not in allowed_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this mission")


    weight_kg = 3.5
    if mission.delivery_id:
        from backend.models.delivery import Delivery as DeliveryModel
        delivery = db.query(DeliveryModel).filter(DeliveryModel.id == mission.delivery_id).first()
        if delivery and delivery.weight_kg:
            weight_kg = float(delivery.weight_kg) + 3.5

    return build_mission_eta(db, mission, weight_kg=weight_kg)


@router.patch("/{mission_id}/fail")
def mark_mission_failed(
    mission_id: int,
    request: FailReasonRequest,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Manually marks a mission as failed with an explicit reason.
    Stops the drone, releases it, marks the delivery as FAILED.
    Accessible: dispatcher, admin
    """
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    if mission.end_time is not None:
        raise HTTPException(status_code=400, detail="Mission is already completed")
    

    fail_mission(db, mission.delivery_id, reason=request.reason)
    

    if mission.delivery_id:
        from backend.services.delivery_service import mark_delivery_as_failed
        mark_delivery_as_failed(db, mission.delivery_id, reason=request.reason)
    
    db.commit()
    

    log_mission_action(
        db, mission, current_user,
        action=AuditAction.OVERRIDE_MANUAL_FAIL,
        description=f"Mission manually failed: {request.reason}"
    )
    
    return {"message": "Mission marked as failed", "mission_id": mission_id, "reason": request.reason}


@router.post("/{mission_id}/pause")
def pause_mission(
    mission_id: int,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Temporarily suspends an active mission.
    The drone remains in its current position until resumed.
    Accessible: dispatcher, admin
    """
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    if mission.end_time is not None:
        raise HTTPException(status_code=400, detail="Mission is already completed")
    
    if mission.status == "weather_hold":
        raise HTTPException(status_code=400, detail="Mission is already paused due to weather")
    

    if mission.drone_id:
        drone = db.query(Drone).filter(Drone.id == mission.drone_id).first()
        if drone:
            log_event(db, mission.id, "MANUAL_PAUSE", f"Mission paused by {current_user.email}")
            mission.status = "paused"
            db.commit()
    

    log_mission_action(
        db, mission, current_user,
        action=AuditAction.OVERRIDE_MANUAL_PAUSE,
        description="Mission manually paused"
    )
    
    return {"message": "Mission paused", "mission_id": mission_id}


@router.post("/{mission_id}/resume")
def resume_mission(
    mission_id: int,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Resumes a manually suspended mission.
    The drone continues its route from its last position.
    Accessible: dispatcher, admin
    """
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    if mission.end_time is not None:
        raise HTTPException(status_code=400, detail="Mission is already completed")
    
    if mission.status != "paused":
        raise HTTPException(status_code=400, detail="Mission is not paused")
    

    if mission.drone_id:
        drone = db.query(Drone).filter(Drone.id == mission.drone_id).first()
        if drone:
            log_event(db, mission.id, "MANUAL_RESUME", f"Mission resumed by {current_user.email}")

            if mission.remaining_km_to_pickup and mission.remaining_km_to_pickup > 0:
                mission.status = "en_route_pickup"
            else:
                mission.status = "en_route_delivery"
            db.commit()
    

    log_mission_action(
        db, mission, current_user,
        action=AuditAction.OVERRIDE_MANUAL_RESUME,
        description="Mission manually resumed"
    )
    
    return {"message": "Mission resumed", "mission_id": mission_id}


@router.get("/{mission_id}/replay")
def get_mission_replay(
    mission_id: int,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    db: Session = Depends(get_db),
):
    """
    Returns data needed for mission replay on the map:
    - calculated route (pickup → destination)
    - events with approximate positions on the path
    - pickup/destination coordinates
    Accessible: dispatcher, admin
    """
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    delivery = mission.delivery
    if not delivery:
        raise HTTPException(status_code=404, detail="Mission has no associated delivery")

    from backend.services.grid import city_grid, haversine_distance
    from backend.services.no_fly_zone_service import get_blocked_cells
    import json

    import re
    raw_events = list(mission.events)
    drone_start_coords = None

    for ev in raw_events:
        if ev.details:
            match = re.search(r"\[([\d\.\-]+),([\d\.\-]+)\]", ev.details)
            if match:
                lat, lon = float(match.group(1)), float(match.group(2))
                if ev.event_type == "PICKING_UP":
                    drone_start_coords = [lat, lon]


    full_route = []
    current_pt = drone_start_coords if drone_start_coords else [delivery.pickup_lat, delivery.pickup_lon]
    
    blocked = get_blocked_cells(db)
    
    def add_leg(start_pt, end_pt):
        leg = city_grid.find_route(start_pt[0], start_pt[1], end_pt[0], end_pt[1], blocked)
        if leg and len(leg) >= 2:
            full_route.extend(leg)
        else:
            full_route.extend([start_pt, end_pt])

    for ev in raw_events:
        if ev.event_type == "PICKED_UP":
            add_leg(current_pt, [delivery.pickup_lat, delivery.pickup_lon])
            current_pt = [delivery.pickup_lat, delivery.pickup_lon]
        elif ev.event_type == "CHARGE" and ev.details:
            match = re.search(r"\[([\d\.\-]+),([\d\.\-]+)\]", ev.details)
            if match:
                st_lat, st_lon = float(match.group(1)), float(match.group(2))
                add_leg(current_pt, [st_lat, st_lon])
                current_pt = [st_lat, st_lon]
                

    add_leg(current_pt, [delivery.dest_lat, delivery.dest_lon])


    route_path = []
    for pt in full_route:
        pt_float = [float(pt[0]), float(pt[1])]
        if not route_path or route_path[-1] != pt_float:
            route_path.append(pt_float)
        

    movement_started = False
    filtered_events = []
    for ev in raw_events:
        if ev.event_type == "PICKING_UP":
            movement_started = True
        

        if not movement_started and ev.event_type in ["PICKED_UP", "AT_PICKUP", "IN_TRANSIT"]:
            movement_started = True

        if movement_started:
            filtered_events.append(ev)
        if ev.event_type in ["DELIVERY_COMPLETED", "ARRIVED", "FAILED", "ABORTED"]:
            break
            
    if not filtered_events:
        filtered_events = raw_events

    events = filtered_events

    drone_start = drone_start_coords if drone_start_coords else route_path[0]


    cumulative_km = [0.0]
    for i in range(1, len(route_path)):
        seg = haversine_distance(
            route_path[i - 1][0], route_path[i - 1][1],
            route_path[i][0], route_path[i][1],
        )
        cumulative_km.append(cumulative_km[-1] + seg)
    total_route_km = cumulative_km[-1] or 1.0

    start_ts = events[0].timestamp.timestamp() if len(events) > 0 else (mission.start_time.timestamp() if mission.start_time else None)
    
    if mission.end_time:
        end_ts = mission.end_time.timestamp()
    elif len(events) > 0:
        end_ts = events[-1].timestamp.timestamp()
    else:
        from datetime import timezone
        end_ts = datetime.now(timezone.utc).timestamp()
        
    duration_sec = max((end_ts - start_ts), 1) if start_ts else 1

    def find_dist_frac_of_coord(lat, lon):
        if not route_path or len(route_path) <= 1:
            return 0.0
        best_frac = 0.0
        best_dist = float('inf')
        for i, pt in enumerate(route_path):
            d = haversine_distance(lat, lon, pt[0], pt[1])
            if d < best_dist:
                best_dist = d
                best_frac = i / (len(route_path) - 1)
        return best_frac


    temp_events = []
    for i in range(len(events)):
        ev = events[i]
        t = ev.timestamp.timestamp()
        time_frac = max(0.0, min(1.0, (t - start_ts) / duration_sec)) if start_ts else 0.0
        
        is_hard = False
        dist_frac = None
        
        if ev.event_type in ["CREATED", "PLANNED", "ASSIGNED", "PICKING_UP"]:
            dist_frac = 0.0
            is_hard = True
        elif ev.event_type in ["PICKED_UP", "AT_PICKUP"]:
            dist_frac = find_dist_frac_of_coord(delivery.pickup_lat, delivery.pickup_lon)
            is_hard = True
        elif ev.event_type == "CHARGE" and ev.details:
            import re
            match = re.search(r"\[([\d\.\-]+),([\d\.\-]+)\]", ev.details)
            if match:
                st_lat, st_lon = float(match.group(1)), float(match.group(2))
                dist_frac = find_dist_frac_of_coord(st_lat, st_lon)
                is_hard = True
        elif ev.event_type in ["DELIVERY_COMPLETED", "ARRIVED"]:
            dist_frac = 1.0
            is_hard = True
            
        temp_events.append({
            "ev": ev,
            "time_frac": time_frac,
            "dist_frac": dist_frac,
            "is_hard": is_hard
        })


    for i in range(len(temp_events)):
        if not temp_events[i]["is_hard"]:
            

            if temp_events[i]["ev"].event_type in ["RESUME", "CHARGE_DETOUR"] and i > 0:
                temp_events[i]["dist_frac"] = temp_events[i-1]["dist_frac"]
                temp_events[i]["is_hard"] = True
                continue


            prev_hard = None
            for j in range(i - 1, -1, -1):
                if temp_events[j]["is_hard"]:
                    prev_hard = temp_events[j]
                    break
            

            next_hard = None
            for j in range(i + 1, len(temp_events)):
                if temp_events[j]["is_hard"]:
                    next_hard = temp_events[j]
                    break
            
            if prev_hard and next_hard:
                dt = next_hard["time_frac"] - prev_hard["time_frac"]
                if dt > 0:
                    ratio = (temp_events[i]["time_frac"] - prev_hard["time_frac"]) / dt
                    temp_events[i]["dist_frac"] = prev_hard["dist_frac"] + ratio * (next_hard["dist_frac"] - prev_hard["dist_frac"])
                else:
                    temp_events[i]["dist_frac"] = prev_hard["dist_frac"]
            elif prev_hard:
                temp_events[i]["dist_frac"] = prev_hard["dist_frac"]
            elif next_hard:
                temp_events[i]["dist_frac"] = next_hard["dist_frac"]
            else:
                temp_events[i]["dist_frac"] = 0.0

    keyframes = []
    current_battery = 100.0
    prev_dist_frac = 0.0


    for i in range(len(temp_events)):
        time_frac = temp_events[i]["time_frac"]
        dist_frac = temp_events[i]["dist_frac"] or 0.0
        ev_type = temp_events[i]["ev"].event_type
        
        dist_since_last = max(0.0, (dist_frac - prev_dist_frac)) * total_route_km
        current_battery = max(15.0, current_battery - (dist_since_last / 1.2))
        
        if i > 0 and temp_events[i-1]["ev"].event_type == "CHARGE":
            current_battery = 100.0
            
        prev_dist_frac = dist_frac
        
        keyframes.append({
            "time_frac": round(time_frac, 4),
            "dist_frac": round(dist_frac, 4),
            "battery": round(current_battery, 1)
        })

    def position_at_dist_frac(frac: float) -> list:
        if not route_path:
            return [0.0, 0.0]
        if frac <= 0:
            return route_path[0]
        if frac >= 1:
            return route_path[-1]
            
        idx = int(frac * (len(route_path) - 1))
        t = frac * (len(route_path) - 1) - idx
        
        a = route_path[min(idx, len(route_path) - 1)]
        b = route_path[min(idx + 1, len(route_path) - 1)]
        
        return [
            round(a[0] + t * (b[0] - a[0]), 6),
            round(a[1] + t * (b[1] - a[1]), 6)
        ]

    events_data = []
    for i, ev in enumerate(events):
        k = keyframes[i]
        pos = position_at_dist_frac(k["dist_frac"])
        events_data.append({
            "id": ev.id,
            "event_type": ev.event_type,
            "timestamp": ev.timestamp.isoformat(),
            "details": ev.details,
            "progress_frac": k["time_frac"],
            "dist_frac": k["dist_frac"],
            "lat": pos[0],
            "lon": pos[1],
        })


    drone = mission.drone
    drone_start = [delivery.pickup_lat, delivery.pickup_lon]

    return {
        "mission_id": mission.id,
        "mission_status": mission.status,
        "start_time": mission.start_time.isoformat() if mission.start_time else None,
        "end_time": mission.end_time.isoformat() if mission.end_time else None,
        "duration_sec": int(duration_sec),
        "drone_id": mission.drone_id,
        "drone_name": drone.name if drone else None,
        "delivery_id": delivery.id,
        "pickup": {"lat": delivery.pickup_lat, "lon": delivery.pickup_lon},
        "destination": {"lat": delivery.dest_lat, "lon": delivery.dest_lon},
        "drone_start": drone_start,
        "route_path": route_path,
        "total_route_km": round(total_route_km, 2),
        "events": events_data,
        "keyframes": keyframes,
        "pickup_waypoint_index": mission.pickup_waypoint_index,
        "progress_pct": mission.progress_pct,
    }
