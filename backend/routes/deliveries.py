"""
Routes for delivery management (Deliveries).
Implements ownership logic and role-based filtering.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_
import json
import statistics
import math

from backend.database import get_db
from backend.models.delivery import Delivery
from backend.models.user import User
from backend.models.drone import Drone
from backend.models.mission import Mission
from backend.schemas.delivery import (
    DeliveryCreate,
    DeliveryResponse,
    DeliveryStatusUpdateRequest,
    DeliveryTimeline,
    ConfirmDeliveryRequest,
    ProofOfDeliveryResponse,
    PaginatedDeliveriesResponse,
    DeliverySearchFilters,
    DeliverySearchResponse,
    DeliveryEstimateRequest,
    DeliveryEstimateResponse,
)
from backend.app.core.delivery_state import (
    DeliveryStatus, MissionStatus,
    ACTIVE_DELIVERY_STATUSES, ASSIGNABLE_DELIVERY_STATUSES, IN_TRANSIT_STATUSES,
)
from backend.services.status_helpers import delivery_status_summary, count_where
from backend.services.delivery_service import (
    auto_assign_delivery,
    get_delivery_by_id,
    get_all_deliveries,
    update_delivery_status,
    estimate_delivery,
    cancel_delivery,
    rank_drones_for_delivery,
    debug_rank_drones_for_delivery,
    build_delivery_timeline,
    diagnose_assignment,
    explain_drone_rejection,
    _generate_confirmation_code,
)
from backend.services.charging_stations import find_station_chain, MAX_AUTONOMY_KM
from backend.services.drone_simulator import SIM_DRONE_SPEED_KM_PER_TICK
from backend.services.auth_dependencies import (
    get_current_user,
    get_current_user_payload,
    require_role,
)
from backend.services.audit_service import (
    log_delivery_created,
    log_delivery_assigned,
    log_delivery_reassigned,
    log_delivery_cancelled,
    log_delivery_status_change,
    log_delivery_confirmed,
    log_audit,
)
from backend.services.email_service import send_order_created_email, send_delivery_confirmation_code
from backend.models.audit_log import AuditAction, AuditEntityType

router = APIRouter(prefix="/deliveries", tags=["deliveries"])


def can_view_delivery(db: Session, user: User, delivery: Delivery) -> bool:
    """
    Determines if a user can view a delivery.
    - Admin: can see anything
    - Dispatcher: can see anything
    - Customer: can see only their own deliveries
    """
    if user.role in ["admin", "dispatcher"]:
        return True
    if user.role == "customer":
        return delivery.customer_id == user.id
    return False


@router.post("/", response_model=DeliveryResponse, status_code=status.HTTP_201_CREATED)
def create_delivery(
    delivery: DeliveryCreate,
    auto_assign: bool = Query(False, description="Automatically assign a drone after creation"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Creates a new delivery with status = pending.
    Pickup and dest are geographic coordinates.
    Priority: normal (default), urgent, emergency.
    Package type: standard, medical, fragile, food.
    Accessible: customer, dispatcher, admin
    """

    if current_user.role not in ["customer", "dispatcher", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only customers, dispatchers, and admins can create deliveries"
        )
    return create_delivery_logic(delivery, auto_assign, current_user, db)

@router.post("/estimate", response_model=DeliveryEstimateResponse)
def estimate_delivery_endpoint(
    request: DeliveryEstimateRequest,
):
    """
    Estimates distance, duration, and feasibility of a delivery.
    Uses centralized logic from backend.
    """
    from backend.services.battery_service import compute_effective_speed, estimate_range_km, estimate_duration_h
    from backend.services.grid import haversine_distance
    from backend.services.charging_stations import find_station_chain


    straight_dist = haversine_distance(request.pickup_lat, request.pickup_lon, request.dest_lat, request.dest_lon)
    dist = straight_dist * 1.05


    mission_weight = 3.5 + request.weight_kg


    max_range = estimate_range_km(100.0, max_battery_wh=500.0, battery_health=100.0, weight_kg=mission_weight)


    needs_charging = dist > max_range
    charging_stops = 0
    is_feasible = True

    if needs_charging:
        chain = find_station_chain(
            request.pickup_lat, request.pickup_lon, request.dest_lat, request.dest_lon,
            first_leg_km=max_range,
            full_leg_km=max_range
        )
        if chain is None:
            is_feasible = False
        else:
            charging_stops = len(chain)
            

    effective_speed = compute_effective_speed(weight_kg=mission_weight)
    duration = estimate_duration_h(
        route_distance_km=dist,
        weight_kg=mission_weight,
        charging_stops=charging_stops
    )

    return DeliveryEstimateResponse(
        distance_km=round(dist, 1),
        effective_speed_kmh=effective_speed,
        estimated_duration_h=duration,
        needs_charging=needs_charging,
        charging_stops=charging_stops,
        is_feasible=is_feasible,
        max_feasible_km=round(max_range * 6, 1)
    )

def create_delivery_logic(
    delivery: DeliveryCreate,
    auto_assign: bool,
    current_user: User,
    db: Session
):
    est_dist, est_dur = estimate_delivery(
        delivery.pickup_lat, delivery.pickup_lon,
        delivery.dest_lat, delivery.dest_lon
    )


    if est_dist > MAX_AUTONOMY_KM:
        chain = find_station_chain(
            delivery.pickup_lat, delivery.pickup_lon,
            delivery.dest_lat, delivery.dest_lon,
            first_leg_km=MAX_AUTONOMY_KM,
            full_leg_km=MAX_AUTONOMY_KM
        )
        if chain is None:
            raise HTTPException(
                status_code=400,
                detail=f"Distance ({est_dist:.1f} km) exceeds maximum autonomy of {MAX_AUTONOMY_KM} km "
                       f"and no accessible charging station chain exists between the two points."
            )

        charging_stops = len(chain)
        est_dur += charging_stops * 0.25
    

    if delivery.priority == "emergency":
        est_dur *= 0.7
    elif delivery.priority == "urgent":
        est_dur *= 0.85
    
    new_delivery = Delivery(
        customer_id=current_user.id,
        pickup_lat=delivery.pickup_lat,
        pickup_lon=delivery.pickup_lon,
        dest_lat=delivery.dest_lat,
        dest_lon=delivery.dest_lon,
        pickup_address=delivery.pickup_address or None,
        dest_address=delivery.dest_address or None,
        priority=delivery.priority,
        package_type=delivery.package_type,
        notes=delivery.notes,
        weight_kg=delivery.weight_kg,
        estimated_distance_km=est_dist,
        estimated_duration_h=est_dur,
        status=DeliveryStatus.PENDING.value,
        confirmation_code=None,
    )
    
    db.add(new_delivery)
    db.flush()


    if auto_assign and current_user.role in ("dispatcher", "admin"):
        assigned = auto_assign_delivery(db, new_delivery)

        if not assigned or not new_delivery.drone_id:
            db.rollback()
            raise HTTPException(
                status_code=400,
                detail="Livrarea nu a fost creată deoarece sistemul nu a găsit o dronă care poate finaliza traseul în siguranță."
            )

        db.refresh(new_delivery)


        log_delivery_created(db, new_delivery, current_user)
        
        assigned_drone = db.query(Drone).filter(Drone.id == new_delivery.drone_id).first()
        if assigned_drone:
            log_delivery_assigned(db, new_delivery, assigned_drone, current_user)

        db.commit()


        customer = db.query(User).filter(User.id == new_delivery.customer_id).first()
        if customer and customer.email:
            send_order_created_email(
                recipient_email=customer.email,
                recipient_name=customer.name or customer.email,
                delivery_id=new_delivery.id,
            )

        return new_delivery


    db.commit()
    db.refresh(new_delivery)


    log_delivery_created(db, new_delivery, current_user)
    db.commit()

    customer = db.query(User).filter(User.id == new_delivery.customer_id).first()
    if customer and customer.email:
        send_order_created_email(
            recipient_email=customer.email,
            recipient_name=customer.name or customer.email,
            delivery_id=new_delivery.id,
        )


    try:
        from backend.routes.ws import manager as ws_manager
        if ws_manager and ws_manager.active_connections:
            ws_manager.queue_broadcast({
                "type": "delivery_update",
                "delivery_id": int(new_delivery.id),
                "status": new_delivery.status,
                "customer_name": current_user.name,
                "priority": new_delivery.priority
            })
    except Exception:
        pass

    return new_delivery


@router.post("/{delivery_id}/assign", status_code=status.HTTP_200_OK)
def assign_delivery(
    delivery_id: int,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Automatically assigns an optimal drone for a pending delivery.
    Accessible: dispatcher, admin
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")

    if delivery.status not in ASSIGNABLE_DELIVERY_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Delivery must be pending to assign. Current status: {delivery.status}"
        )

    try:
        result = auto_assign_delivery(db, delivery)
        db.refresh(delivery)

        if delivery.drone_id:

            assigned_drone = db.query(Drone).filter(Drone.id == delivery.drone_id).first()
            if assigned_drone:
                log_delivery_assigned(db, delivery, assigned_drone, current_user)


            try:
                from backend.routes.ws import manager as ws_manager
                if ws_manager and ws_manager.active_connections:
                    ws_manager.queue_broadcast({
                        "type": "delivery_update",
                        "delivery_id": int(delivery.id),
                        "status": delivery.status,
                        "drone_id": int(delivery.drone_id),
                    })
            except Exception:
                pass

            return {
                "message": f"Delivery #{delivery.id} assigned to drone #{delivery.drone_id}",
                "delivery_id": delivery.id,
                "drone_id": delivery.drone_id,
                "status": delivery.status,
            }
        else:
            raise HTTPException(
                status_code=400,
                detail="Livrarea nu a fost creată deoarece sistemul nu a găsit o dronă care poate finaliza traseul în siguranță."
            )
    except Exception as e:
        import traceback
        with open("error_assign.log", "a", encoding="utf-8") as f:
            f.write(f"\n[{datetime.now()}] ERROR in assign_delivery {delivery_id}: {str(e)}\n")
            f.write(traceback.format_exc())
            f.write("-" * 50 + "\n")
        
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


from pydantic import BaseModel

class ManualReassignRequest(BaseModel):
    drone_id: int

@router.post("/{delivery_id}/reassign", status_code=status.HTTP_200_OK)
def manual_reassign_delivery(
    delivery_id: int,
    req: ManualReassignRequest,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Manually reassigns a delivery to an explicitly chosen drone.
    Accessible: dispatcher, admin
    """
    from backend.services.delivery_service import manual_reassign_delivery_locked
    
    success = manual_reassign_delivery_locked(
        db=db,
        delivery_id=delivery_id,
        drone_id=req.drone_id,
        user_email=current_user.email
    )

    if not success:
        raise HTTPException(
            status_code=400,
            detail="Reassignment failed. Ensure drone is idle and a route is possible."
        )


    delivery = get_delivery_by_id(db, delivery_id)
    drone = db.query(Drone).filter(Drone.id == req.drone_id).first()
    
    try:
        from backend.routes.ws import manager as ws_manager
        if ws_manager and ws_manager.active_connections:
            ws_manager.queue_broadcast({
                "type": "delivery_update",
                "delivery_id": int(delivery.id),
                "status": delivery.status,
                "drone_id": int(drone.id),
            })
            ws_manager.queue_broadcast({
                "type": "drone_update",
                "drone_id": int(drone.id),
                "status": drone.status,
                "latitude": drone.latitude,
                "longitude": drone.longitude,
                "battery": drone.battery,
                "route_index": 0,
                "route_path": drone.route_path,
                "planned_route_path": drone.planned_route_path,
            })
    except Exception:
        pass

    return {"message": f"Delivery reassigned to drone {drone.name}", "delivery_id": delivery.id, "drone_id": drone.id}


@router.post("/{delivery_id}/cancel", status_code=status.HTTP_200_OK)
def cancel_delivery_endpoint(
    delivery_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Cancels a delivery (only if PENDING or ASSIGNED).
    Accessible: customer (own delivery only), dispatcher, admin
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")

    if not can_view_delivery(db, current_user, delivery):
        raise HTTPException(status_code=403, detail="Access denied")

    if delivery.status not in (ASSIGNABLE_DELIVERY_STATUSES | {DeliveryStatus.ASSIGNED.value}):
        raise HTTPException(
            status_code=400,
            detail="Only pending or assigned deliveries can be cancelled"
        )

    success = cancel_delivery(db, delivery_id, reason="Cancelled by user")
    if not success:
        raise HTTPException(status_code=400, detail="Could not cancel delivery")


    db.refresh(delivery)
    log_delivery_cancelled(db, delivery, current_user, reason="Cancelled by user")

    return {"message": "Delivery cancelled"}


@router.patch("/{delivery_id}/force-cancel", status_code=status.HTTP_200_OK)
def force_cancel_delivery(
    delivery_id: int,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Forcefully cancels a delivery, regardless of status.
    Stops active mission, frees the drone, marks delivery as CANCELLED.
    Accessible: dispatcher, admin
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    
    if delivery.status in (DeliveryStatus.DELIVERED.value, DeliveryStatus.CANCELLED.value, DeliveryStatus.FAILED.value):
        raise HTTPException(status_code=400, detail="Delivery is already in a final state")
    if delivery.confirmed_at is not None:
        raise HTTPException(status_code=400, detail="Cannot cancel a delivery that has already been confirmed by the recipient")
    

    if delivery.drone_id:
        drone = db.query(Drone).filter(Drone.id == delivery.drone_id).first()
        if drone:
            drone.status = "idle"
            drone.route_path = None
            drone.route_index = 0
            drone.dest_latitude = None
            drone.dest_longitude = None
            drone.stuck_steps = 0
            drone.charge_count = 0
            db.commit()
        

        mission = db.query(Mission).filter(
            Mission.delivery_id == delivery.id,
            Mission.end_time == None
        ).first()
        if mission:
            from backend.services.mission_service import abort_mission
            abort_mission(db, delivery.id, reason=f"Force cancelled by {current_user.email}")
    

    delivery.status = DeliveryStatus.CANCELLED.value
    delivery.completed_at = datetime.now(timezone.utc)
    delivery.drone_id = None
    db.commit()
    

    try:
        from backend.routes.ws import manager as ws_manager
        if ws_manager and ws_manager.active_connections:
            ws_manager.queue_broadcast({
                "type": "delivery_update",
                "delivery_id": int(delivery.id),
                "status": delivery.status,
                "drone_id": None,
            })
    except Exception:
        pass
    

    log_delivery_cancelled(db, delivery, current_user, reason="Force cancelled", force=True)
    
    return {"message": "Delivery force-cancelled", "delivery_id": delivery.id, "status": delivery.status}


@router.get("/{delivery_id}/diagnostics", status_code=status.HTTP_200_OK)
def get_delivery_diagnostics(
    delivery_id: int,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Detailed diagnostics for delivery assignment.
    Returns reasons why each drone was not chosen.
    Accessible: dispatcher, admin
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    
    return diagnose_assignment(db, delivery)


@router.get("/{delivery_id}/explain-drone/{drone_id}", status_code=status.HTTP_200_OK)
def explain_drone_for_delivery(
    delivery_id: int,
    drone_id: int,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Explains why a specific drone was not chosen for a delivery.
    Returns technical details about identified blockers.
    Accessible: dispatcher, admin
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    
    return explain_drone_rejection(db, drone_id, delivery)


@router.post("/{delivery_id}/confirm", status_code=status.HTTP_200_OK)
def confirm_delivery_reception(
    delivery_id: int,
    request: ConfirmDeliveryRequest,
    db: Session = Depends(get_db)
):
    """
    Confirms reception of a delivery using the 6-digit code.
    PUBLIC endpoint - no authentication required (recipient uses the code).
    
    Flow:
    1. Drone arrives at destination, status becomes DELIVERED
    2. Recipient receives the code (displayed on drone screen/SMS/email)
    3. Recipient confirms with code + name + signature (optional)
    4. System marks delivery as confirmed
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    

    if delivery.status != DeliveryStatus.DELIVERED.value:
        raise HTTPException(
            status_code=400,
            detail=f"Delivery must be in DELIVERED status to confirm. Current: {delivery.status}"
        )
    

    if delivery.confirmed_at is not None:
        raise HTTPException(status_code=400, detail="Delivery already confirmed")
    

    if delivery.confirmation_code != request.confirmation_code:
        raise HTTPException(status_code=400, detail="Invalid confirmation code")
    

    delivery.confirmed_at = datetime.now(timezone.utc)
    delivery.recipient_name = request.recipient_name
    if request.recipient_signature:
        delivery.recipient_signature = request.recipient_signature
    if request.delivery_photo_url:
        delivery.delivery_photo_url = request.delivery_photo_url
    if request.delivery_notes:
        delivery.delivery_notes = request.delivery_notes
    
    db.commit()
    

    try:
        from backend.routes.ws import manager as ws_manager
        if ws_manager and ws_manager.active_connections:
            ws_manager.queue_broadcast({
                "type": "delivery_confirmed",
                "delivery_id": int(delivery.id),
                "confirmed_at": delivery.confirmed_at.isoformat(),
                "recipient_name": delivery.recipient_name,
            })
    except Exception:
        pass
    

    log_delivery_confirmed(db, delivery, recipient_name=request.recipient_name)
    
    return {
        "message": "Delivery confirmed successfully",
        "delivery_id": delivery.id,
        "confirmed_at": delivery.confirmed_at.isoformat(),
        "recipient_name": delivery.recipient_name,
    }


@router.get("/{delivery_id}/proof", response_model=ProofOfDeliveryResponse)
def get_proof_of_delivery(
    delivery_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Gets Proof of Delivery (PoD) for a delivery.
    Includes: timestamp, recipient, signature, notes.
    Accessible: customer (own delivery only), dispatcher, admin
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    
    if not can_view_delivery(db, current_user, delivery):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if delivery.status != DeliveryStatus.DELIVERED.value:
        raise HTTPException(status_code=400, detail="Proof of delivery only available for delivered packages")
    
    return ProofOfDeliveryResponse(
        delivery_id=delivery.id,
        status=delivery.status,
        pickup_lat=delivery.pickup_lat,
        pickup_lon=delivery.pickup_lon,
        dest_lat=delivery.dest_lat,
        dest_lon=delivery.dest_lon,
        package_type=delivery.package_type or "standard",
        weight_kg=delivery.weight_kg or 1.0,
        created_at=delivery.created_at,
        completed_at=delivery.completed_at,
        confirmed_at=delivery.confirmed_at,
        confirmation_code=delivery.confirmation_code,
        recipient_name=delivery.recipient_name,
        recipient_signature=delivery.recipient_signature,
        delivery_photo_url=delivery.delivery_photo_url,
        delivery_notes=delivery.delivery_notes,
        drone_id=delivery.drone_id,
        customer_id=delivery.customer_id,
    )


@router.patch("/{delivery_id}/photo", status_code=status.HTTP_200_OK)
def upload_delivery_photo(
    delivery_id: int,
    photo_url: str = Body(..., embed=True),
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Adds delivery photo URL (taken by drone camera at destination).
    In production, this would be a real upload; here we accept a URL.
    Accessible: dispatcher, admin (or automated drone system)
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    
    delivery.delivery_photo_url = photo_url
    db.commit()
    
    return {"message": "Photo URL saved", "delivery_id": delivery.id, "photo_url": photo_url}


@router.get("/", response_model=PaginatedDeliveriesResponse)
def list_deliveries(
    status_filter: str = Query(None, alias="status", description="Status filter (or comma-separated list)"),
    priority: str = Query(None, description="Priority filter (or comma-separated list)"),
    package_type: str = Query(None, description="Package type filter"),
    drone_id: int = Query(None, description="Filter by assigned drone"),
    date_from: datetime = Query(None, description="Creation date >= (ISO format)"),
    date_to: datetime = Query(None, description="Creation date <= (ISO format)"),
    confirmed: bool = Query(None, description="Confirmed/unconfirmed PoD filter"),
    search_id: int = Query(None, alias="id", description="Exact search by delivery ID"),
    sort_by: str = Query("created_at", description="Sort field: created_at, completed_at, priority, status"),
    sort_order: str = Query("desc", description="Order: asc or desc"),
    page: int = Query(1, ge=1, description="Current page"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Lists deliveries with advanced filtering and pagination.
    
    Available filters:
    - status: pending, assigned, in_transit, delivered, failed, cancelled
    - priority: low, normal, urgent, high, emergency
    - package_type: standard, medical, fragile, food
    - drone_id: ID of assigned drone
    - date_from/date_to: creation interval
    - confirmed: true/false for confirmed PoD
    - id: exact search by ID
    
    Sorting: created_at, completed_at, priority, status
    Pagination: page (1-based), page_size (max 100)
    """
    query = db.query(Delivery).options(joinedload(Delivery.customer))
    

    if current_user.role == "customer":
        from sqlalchemy import or_
        query = query.filter(
            Delivery.customer_id == current_user.id,
            or_(Delivery.notes == None, ~Delivery.notes.like("%[DEMO]%"))
        )
    elif current_user.role not in ["admin", "dispatcher"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to view deliveries"
        )
    

    if search_id:
        query = query.filter(Delivery.id == search_id)
    

    if status_filter:
        statuses = [s.strip() for s in status_filter.split(",")]
        query = query.filter(Delivery.status.in_(statuses))
    

    if priority:
        priorities = [p.strip() for p in priority.split(",")]
        query = query.filter(Delivery.priority.in_(priorities))
    

    if package_type:
        types = [t.strip() for t in package_type.split(",")]
        query = query.filter(Delivery.package_type.in_(types))
    

    if drone_id:
        query = query.filter(Delivery.drone_id == drone_id)
    

    if date_from:
        query = query.filter(Delivery.created_at >= date_from)
    if date_to:
        query = query.filter(Delivery.created_at <= date_to)
    

    if confirmed is not None:
        if confirmed:
            query = query.filter(Delivery.confirmed_at != None)
        else:
            query = query.filter(Delivery.confirmed_at == None)
    

    total = query.count()
    

    sort_column = getattr(Delivery, sort_by, Delivery.created_at)
    if sort_order.lower() == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())
    

    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    offset = (page - 1) * page_size
    deliveries = query.offset(offset).limit(page_size).all()
    
    return PaginatedDeliveriesResponse(
        items=deliveries,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        has_next=page < total_pages,
        has_prev=page > 1,
    )


@router.post("/search", response_model=DeliverySearchResponse)
def search_deliveries(
    filters: DeliverySearchFilters,
    sort_by: str = Query("created_at", description="Câmp sortare"),
    sort_order: str = Query("desc", description="Ordine: asc sau desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Advanced delivery search with multiple filters (POST body).
    Allows complex combinations of filters.
    """
    query = db.query(Delivery).options(joinedload(Delivery.customer))
    

    if current_user.role == "customer":
        from sqlalchemy import or_
        query = query.filter(
            Delivery.customer_id == current_user.id,
            or_(Delivery.notes == None, ~Delivery.notes.like("%[DEMO]%"))
        )
    elif current_user.role not in ["admin", "dispatcher"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    filters_applied = {}
    

    if filters.search_id:
        query = query.filter(Delivery.id == filters.search_id)
        filters_applied["search_id"] = filters.search_id
    

    if filters.status:
        query = query.filter(Delivery.status.in_(filters.status))
        filters_applied["status"] = filters.status
    

    if filters.priority:
        query = query.filter(Delivery.priority.in_(filters.priority))
        filters_applied["priority"] = filters.priority
    

    if filters.package_type:
        query = query.filter(Delivery.package_type.in_(filters.package_type))
        filters_applied["package_type"] = filters.package_type
    

    if filters.drone_id:
        query = query.filter(Delivery.drone_id == filters.drone_id)
        filters_applied["drone_id"] = filters.drone_id
    

    if filters.customer_id and current_user.role in ["admin", "dispatcher"]:
        query = query.filter(Delivery.customer_id == filters.customer_id)
        filters_applied["customer_id"] = filters.customer_id
    

    if filters.order_type and filters.order_type != "all" and current_user.role in ["admin", "dispatcher"]:
        from backend.models.user import User


        if filters.order_type == "demo":
            query = query.filter(Delivery.customer.has(User.name.like("%Demo%")))
        elif filters.order_type == "real":
            query = query.filter(~Delivery.customer.has(User.name.like("%Demo%")))
        filters_applied["order_type"] = filters.order_type
    

    if filters.date_from:
        query = query.filter(Delivery.created_at >= filters.date_from)
        filters_applied["date_from"] = filters.date_from.isoformat()
    if filters.date_to:
        query = query.filter(Delivery.created_at <= filters.date_to)
        filters_applied["date_to"] = filters.date_to.isoformat()
    

    if filters.completed_from:
        query = query.filter(Delivery.completed_at >= filters.completed_from)
        filters_applied["completed_from"] = filters.completed_from.isoformat()
    if filters.completed_to:
        query = query.filter(Delivery.completed_at <= filters.completed_to)
        filters_applied["completed_to"] = filters.completed_to.isoformat()
    

    if filters.confirmed is not None:
        if filters.confirmed:
            query = query.filter(Delivery.confirmed_at != None)
        else:
            query = query.filter(Delivery.confirmed_at == None)
        filters_applied["confirmed"] = filters.confirmed
    

    if filters.min_weight:
        query = query.filter(Delivery.weight_kg >= filters.min_weight)
        filters_applied["min_weight"] = filters.min_weight
    if filters.max_weight:
        query = query.filter(Delivery.weight_kg <= filters.max_weight)
        filters_applied["max_weight"] = filters.max_weight
    

    total = query.count()
    

    sort_column = getattr(Delivery, sort_by, Delivery.created_at)
    if sort_order.lower() == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())
    

    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    offset = (page - 1) * page_size
    deliveries = query.offset(offset).limit(page_size).all()
    
    return DeliverySearchResponse(
        items=deliveries,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        filters_applied=filters_applied,
        sort_by=sort_by,
        sort_order=sort_order,
    )


@router.get("/history/completed", response_model=PaginatedDeliveriesResponse)
def list_completed_deliveries(
    date_from: datetime = Query(None, description="Completion date >= (ISO format)"),
    date_to: datetime = Query(None, description="Completion date <= (ISO format)"),
    drone_id: int = Query(None, description="Filter by drone"),
    customer_id: int = Query(None, description="Filter by customer (admin/dispatcher)"),
    priority: str = Query(None, description="Priority filter"),
    confirmed_only: bool = Query(False, description="Only deliveries with confirmed PoD"),
    sort_by: str = Query("completed_at", description="Sort field"),
    sort_order: str = Query("desc", description="Order: asc or desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Completed delivery history (delivered or failed).
    Optimized for reports and analysis.
    """
    query = db.query(Delivery).options(joinedload(Delivery.customer)).filter(
        Delivery.status.in_([DeliveryStatus.DELIVERED.value, DeliveryStatus.FAILED.value])
    )
    

    if current_user.role == "customer":
        from sqlalchemy import or_
        query = query.filter(
            Delivery.customer_id == current_user.id,
            or_(Delivery.notes == None, ~Delivery.notes.like("%[DEMO]%"))
        )
    elif current_user.role not in ["admin", "dispatcher"]:
        raise HTTPException(status_code=403, detail="Access denied")
    

    if date_from:
        query = query.filter(Delivery.completed_at >= date_from)
    if date_to:
        query = query.filter(Delivery.completed_at <= date_to)
    if drone_id:
        query = query.filter(Delivery.drone_id == drone_id)
    if customer_id and current_user.role in ["admin", "dispatcher"]:
        query = query.filter(Delivery.customer_id == customer_id)
    if priority:
        priorities = [p.strip() for p in priority.split(",")]
        query = query.filter(Delivery.priority.in_(priorities))
    if confirmed_only:
        query = query.filter(Delivery.confirmed_at != None)
    

    total = query.count()
    

    sort_column = getattr(Delivery, sort_by, Delivery.completed_at)
    if sort_order.lower() == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())
    

    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    offset = (page - 1) * page_size
    deliveries = query.offset(offset).limit(page_size).all()
    
    return PaginatedDeliveriesResponse(
        items=deliveries,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        has_next=page < total_pages,
        has_prev=page > 1,
    )


@router.get("/fleet/scores/{delivery_id}", response_model=dict)
def get_drone_scores(
    delivery_id: int,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns scores of all drones for a specific delivery using the unified ranking logic.
    Accessible: dispatcher, admin
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")


    ranked_results = rank_drones_for_delivery(db, delivery)

    scores = []
    for item in ranked_results:
        drone = item["drone"]

        scores.append({
            "drone_id": drone.id,
            "drone_name": drone.name,
            "score": round(item["score"], 2),
            "dist_to_pickup_km": item["dist_to_pickup_km"],
            "total_dist": item["route_total_km"],
            "charging_stops": item["charging_stops"],
            "battery": drone.battery,
            "battery_health": getattr(drone, "battery_health", 100.0),
            "status": drone.status,
        })

    return {
        "delivery_id": delivery.id,
        "priority": delivery.priority,
        "scores": scores,
        "best_drone": scores[0] if scores else None,
        "logic": "unified_advanced_scoring"
    }


@router.get("/fleet/ranking-debug/{delivery_id}", response_model=dict)
def get_ranking_debug(
    delivery_id: int,
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Full debug view of drone ranking for a delivery.
    Shows every drone: eligible/ineligible, scored/rejected, reason, and score details.
    Accessible: dispatcher, admin
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")

    return debug_rank_drones_for_delivery(db, delivery)


@router.post("/batch-assign", status_code=status.HTTP_200_OK)
def batch_assign_deliveries(
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Fleet optimization: automatically assigns all pending deliveries to available drones.
    Uses multi-criteria scoring: distance, battery, health, priority, weather.
    Accessible: dispatcher, admin
    """
    from backend.services.fleet_optimizer import optimize_batch_assignment
    result = optimize_batch_assignment(db)


    try:
        from backend.routes.ws import manager as ws_manager
        if ws_manager and ws_manager.active_connections:
            ws_manager.queue_broadcast({
                "type": "fleet_update",
                "batch_assign": True,
                "assigned": result["assigned"],
            })
    except Exception:
        pass

    return result


@router.get("/dashboard/customer", response_model=dict)
def customer_dashboard(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Dashboard for CUSTOMER.
    Shows own deliveries and statistics.
    """

    if current_user.role not in ["customer", "admin", "dispatcher"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied for this role"
        )
    
    customer_deliveries = db.query(Delivery).filter(
        Delivery.customer_id == current_user.id
    ).all()

    summary = delivery_status_summary(
        customer_deliveries,
        assignable=ASSIGNABLE_DELIVERY_STATUSES,
        in_transit=IN_TRANSIT_STATUSES,
    )
    return {
        "user_id": current_user.id,
        "user_role": current_user.role,
        **summary,
        "recent_deliveries": [
            {
                "id": d.id,
                "status": d.status,
                "priority": d.priority,
                "package_type": d.package_type,
                "drone_id": d.drone_id,
                "created_at": d.created_at,
                "confirmed_at": d.confirmed_at,
                "failure_reason": d.failure_reason,
                "estimated_distance_km": (
                    d.estimated_distance_km
                    if d.estimated_distance_km is not None
                    else (
                        round(
                            2 * 6371 * math.asin(math.sqrt(
                                math.sin(math.radians(d.dest_lat - d.pickup_lat) / 2) ** 2
                                + math.cos(math.radians(d.pickup_lat))
                                * math.cos(math.radians(d.dest_lat))
                                * math.sin(math.radians(d.dest_lon - d.pickup_lon) / 2) ** 2
                            )) * 1.05,
                            1
                        )
                        if d.pickup_lat and d.dest_lat else None
                    )
                ),
                "estimated_duration_h": d.estimated_duration_h,
                "dest_address": getattr(d, "dest_address", None),
                "pickup_address": getattr(d, "pickup_address", None),
                "dest_lat": d.dest_lat,
                "dest_lon": d.dest_lon,
                "pickup_lat": d.pickup_lat,
                "pickup_lon": d.pickup_lon,
                "completed_at": d.completed_at,
            }
            for d in sorted(customer_deliveries, key=lambda x: x.created_at, reverse=True)
        ]
    }


@router.get("/dashboard/dispatcher", response_model=dict)
def dispatcher_dashboard(
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Dashboard for DISPATCHER.
    Shows all deliveries, drone availability, and assignment statistics.
    """
    all_deliveries = db.query(Delivery).options(joinedload(Delivery.customer)).all()

    from backend.models.drone import Drone
    drones = db.query(Drone).all()
    available_drones = [d for d in drones if d.status == "idle"]
    busy_drones = [d for d in drones if d.status != "idle"]

    summary = delivery_status_summary(
        all_deliveries,
        assignable=ASSIGNABLE_DELIVERY_STATUSES,
        in_transit=IN_TRANSIT_STATUSES,
    )
    pending_deliveries = [
        d for d in all_deliveries if d.status in ASSIGNABLE_DELIVERY_STATUSES
    ]

    return {
        "user_id": current_user.id,
        "user_role": current_user.role,
        "deliveries": summary,
        "drones": {
            "total": len(drones),
            "available": len(available_drones),
            "busy": len(busy_drones),
        },
        "urgent_actions": {
            "pending_unassigned": [
                {
                    "id": d.id,
                    "customer_id": d.customer_id,
                    "customer_name": d.customer.name if d.customer else None,
                    "distance_km": d.estimated_distance_km,
                    "priority": getattr(d, "priority", "normal") or "normal",
                    "package_type": getattr(d, "package_type", "standard") or "standard",
                    "weight_kg": getattr(d, "weight_kg", None),
                }
                for d in sorted(
                    pending_deliveries,
                    key=lambda x: (
                        -{"emergency": 2, "urgent": 1, "normal": 0}.get(getattr(x, "priority", "normal") or "normal", 0),
                        -x.id
                    ),
                )
            ][:20]
        }
    }


@router.get("/dashboard/stats", response_model=dict)
def delivery_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    General delivery statistics.
    Role-based filtering - customers see only their own stats.
    """
    if current_user.role == "customer":
        deliveries = db.query(Delivery).filter(Delivery.customer_id == current_user.id).all()
    else:
        deliveries = db.query(Delivery).all()

    return delivery_status_summary(
        deliveries,
        assignable=ASSIGNABLE_DELIVERY_STATUSES,
        in_transit=IN_TRANSIT_STATUSES,
    )


@router.get("/dashboard/analytics", response_model=dict)
def delivery_analytics(
    range_: str = Query("7d", alias="range"),
    _: dict = Depends(require_role("admin", "dispatcher")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Advanced aggregate statistics for dashboard analytics.
    Accessible: admin, dispatcher.
    """
    from datetime import datetime, date, timedelta
    from collections import defaultdict
    from backend.models.mission_event import MissionEvent
    from backend.services.battery_service import compute_battery_drain_pct

    deliveries_all = db.query(Delivery).all()
    missions_all = db.query(Mission).all()
    drones = db.query(Drone).all()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    if range_ == "1d":
        start_date = now - timedelta(hours=24)
    elif range_ == "30d":
        start_date = datetime.combine(now.date() - timedelta(days=29), datetime.min.time())
    else:
        start_date = datetime.combine(now.date() - timedelta(days=6), datetime.min.time())

    deliveries = [d for d in deliveries_all if (d.created_at and d.created_at >= start_date) or (d.completed_at and d.completed_at >= start_date)]
    missions = [m for m in missions_all if (m.start_time and m.start_time >= start_date) or (m.end_time and m.end_time >= start_date)]

    today_start = datetime.combine(now.date(), datetime.min.time())
    week_start = today_start - timedelta(days=today_start.weekday())

    total_deliveries = len(deliveries)
    from backend.app.core.delivery_state import ASSIGNABLE_DELIVERY_STATUSES
    
    delivered = [d for d in deliveries if d.status == DeliveryStatus.DELIVERED.value]
    failed_deliveries = [d for d in deliveries if d.status == DeliveryStatus.FAILED.value]
    cancelled_deliveries = [d for d in deliveries if d.status == DeliveryStatus.CANCELLED.value]
    active_deliveries = [d for d in deliveries if d.status in ACTIVE_DELIVERY_STATUSES]
    pending_deliveries = [d for d in deliveries if d.status in ASSIGNABLE_DELIVERY_STATUSES]

    success_count = len(delivered)
    fail_count = len(failed_deliveries)
    cancel_count = len(cancelled_deliveries)

    finished_count = success_count + fail_count
    success_rate = round((success_count / finished_count * 100), 1) if finished_count else None


    completed_today = sum(
        1 for d in delivered
        if d.completed_at and d.completed_at >= today_start
    )
    completed_this_week = sum(
        1 for d in delivered
        if d.completed_at and d.completed_at >= week_start
    )
    failed_today = sum(
        1 for d in failed_deliveries
        if d.completed_at and d.completed_at >= today_start
    )


    delivery_times_h = []
    for d in delivered:
        if d.completed_at and d.created_at and d.created_at >= start_date:
            dt = (d.completed_at - d.created_at).total_seconds() / 3600
            delivery_times_h.append(dt)


    avg_delivery_time_h = round(statistics.median(delivery_times_h), 3) if delivery_times_h else None


    distances = [d.estimated_distance_km for d in delivered if d.estimated_distance_km]
    avg_distance_km = round(sum(distances) / len(distances), 1) if distances else None
    total_distance_km = round(sum(distances), 1) if distances else 0


    battery_drains = []
    for m in missions:
        if m.status == "completed" and m.total_distance_km and m.total_distance_km > 0:
            pct = compute_battery_drain_pct(
                distance_km=m.total_distance_km,
                max_battery_wh=500.0,
                battery_health=100.0,
            )
            battery_drains.append(pct)
    avg_battery_consumption_pct = round(sum(battery_drains) / len(battery_drains), 2) if battery_drains else None


    weights = [d.weight_kg for d in deliveries if d.weight_kg]
    avg_weight_kg = round(sum(weights) / len(weights), 2) if weights else None


    completed_missions = [m for m in missions if m.status == "completed"]
    failed_missions = [m for m in missions if m.status == "failed"]
    aborted_missions = [m for m in missions if m.status == "aborted"]

    mission_durations = [m.actual_duration_h for m in completed_missions if m.actual_duration_h]
    avg_mission_duration_h = round(sum(mission_durations) / len(mission_durations), 3) if mission_durations else None

    mission_distances = [m.total_distance_km or m.estimated_distance_km for m in completed_missions if (m.total_distance_km or m.estimated_distance_km)]
    avg_mission_distance_km = round(sum(mission_distances) / len(mission_distances), 1) if mission_distances else None


    mission_ids = [m.id for m in missions]
    if mission_ids:
        total_charging_stops = db.query(MissionEvent).filter(
            MissionEvent.mission_id.in_(mission_ids),
            MissionEvent.event_type == "CHARGE"
        ).count()
        weather_hold_count = db.query(MissionEvent).filter(
            MissionEvent.mission_id.in_(mission_ids),
            MissionEvent.event_type == "WEATHER_HOLD"
        ).count()
    else:
        total_charging_stops = 0
        weather_hold_count = 0


    total_drones = len(drones)
    active_drones = len([dr for dr in drones if dr.status in ("in_mission", "going_to_charging")])
    charging_drones = len([dr for dr in drones if dr.status == "charging"])
    idle_drones = len([dr for dr in drones if dr.status == "idle"])
    

    period_hours = 168
    if range_ == "1d":
        period_hours = 24
    elif range_ == "30d":
        period_hours = 720
        

    mission_durations = []
    for m in completed_missions:
        if m.actual_duration_h and 0.016 <= m.actual_duration_h <= 3.0:
            mission_durations.append(m.actual_duration_h)
        else:
            mission_durations.append(0.5)
            
    total_flight_hours = sum(mission_durations)
    total_available_hours = total_drones * period_hours if total_drones else 1
    

    utilization_pct = round(((total_flight_hours / total_available_hours) * 100), 2)


    drone_mission_counts: dict[int, int] = defaultdict(int)
    drone_delivery_counts: dict[int, int] = defaultdict(int)
    drone_mission_distances: dict[int, float] = defaultdict(float)
    
    for m in completed_missions:
        if m.drone_id:
            drone_mission_counts[m.drone_id] += 1
            drone_mission_distances[m.drone_id] += (m.total_distance_km or m.estimated_distance_km or 0.0)
    for d in delivered:
        if d.drone_id:
            drone_delivery_counts[d.drone_id] += 1

    most_used_drone = None
    if drone_mission_counts:

        top_drone_id = max(drone_mission_counts, key=lambda k: (drone_mission_counts[k], drone_mission_distances[k]))
        top_drone = next((dr for dr in drones if dr.id == top_drone_id), None)
        if top_drone:
            most_used_drone = {
                "id": top_drone.id,
                "name": top_drone.name,
                "completed_missions": drone_mission_counts[top_drone_id],
                "completed_deliveries": drone_delivery_counts.get(top_drone_id, 0),
                "total_flight_km": round(float(drone_mission_distances[top_drone_id]), 1),
            }


    drone_leaderboard = []
    for dr in sorted(drones, key=lambda x: drone_mission_counts.get(x.id, 0), reverse=True):
        drone_leaderboard.append({
            "id": dr.id,
            "name": dr.name,
            "status": dr.status,
            "battery_pct": round(float(dr.battery or 0), 1),
            "battery_health_pct": round(float(dr.battery_health or 100), 1),
            "total_flight_km": round(float(drone_mission_distances.get(dr.id, 0)), 1),
            "total_charge_cycles": int(dr.total_charge_cycles or 0),
            "completed_missions": drone_mission_counts.get(dr.id, 0),
            "completed_deliveries": drone_delivery_counts.get(dr.id, 0),
            "motor_efficiency_pct": round(float(dr.motor_efficiency or 0.92) * 100, 1),
        })


    total_fleet_km = round(sum(mission_distances), 1) if mission_distances else 0
    active_drones_in_period = len(drone_mission_counts)
    avg_flight_km_per_drone = round(total_fleet_km / max(active_drones_in_period, 1), 1)
    
    avg_battery_health = round(sum(dr.battery_health for dr in drones) / max(total_drones, 1), 1) if total_drones else 0
    total_charge_cycles = total_charging_stops


    failed_mission_ids = {m.delivery_id: m.id for m in missions if m.status in ("failed", "aborted") and m.delivery_id is not None}
    sim_failure_details: dict[int, str] = {}
    if failed_mission_ids:
        sim_events = db.query(MissionEvent).filter(
            MissionEvent.mission_id.in_(list(failed_mission_ids.values())),
            MissionEvent.event_type.in_(["FAILED", "STUCK"]),
        ).all()
        for ev in sim_events:
            raw_detail = (ev.details or "").strip()

            if raw_detail and not raw_detail.lower().startswith("delivery_failed"):

                for del_id, mis_id in failed_mission_ids.items():
                    if mis_id == ev.mission_id and del_id not in sim_failure_details:
                        sim_failure_details[del_id] = raw_detail

    def _classify_cause(text: str) -> str:
        r = text.lower()
        if not r:
            return "unknown"
        if "weather" in r or "storm" in r or "wind" in r or "vreme" in r or "furtun" in r:
            return "weather"


        if ("route" in r or "path" in r or "blocat" in r or "rut" in r
                or "safe" in r or "nfz" in r or "no-fly" in r or "no fly" in r
                or "zon" in r or "fără" in r):
            return "route_blocked"
        if "battery" in r or "charg" in r or "baterie" in r or "epuizat" in r or "stuck" in r:
            return "battery"
        if "reassign" in r or "assignment" in r or "conflict" in r or "motor" in r:
            return "reassignment"
        if "abort" in r or "cancel" in r or "anulat" in r:
            return "aborted_by_dispatcher"
        return "other"

    failed_by_cause: dict[str, int] = defaultdict(int)
    for d in failed_deliveries:
        raw = ""

        if d.failure_reason:
            raw = d.failure_reason.strip()

        elif d.notes:
            n = d.notes.lower()
            if "nfz" in n or "no-fly" in n or "no fly" in n or "zone" in n or "conflict" in n:
                raw = "route_blocked_nfz"
            elif "storm" in n or "weather" in n or "vreme" in n or "furtun" in n:
                raw = "weather"
            elif "battery" in n or "baterie" in n:
                raw = "battery"

        if not raw and d.id in sim_failure_details:
            raw = sim_failure_details[d.id]
        failed_by_cause[_classify_cause(raw)] += 1


    deliveries_time_series = []

    if range_ == "1d":
        for i in range(24):
            pt_start = start_date + timedelta(hours=i)
            pt_end = pt_start + timedelta(hours=1)
            day_delivered = sum(1 for d in delivered if d.completed_at and pt_start <= d.completed_at < pt_end)
            day_failed = sum(1 for d in failed_deliveries if d.completed_at and pt_start <= d.completed_at < pt_end)
            day_created = sum(1 for d in deliveries if d.created_at and pt_start <= d.created_at < pt_end)
            deliveries_time_series.append({
                "date": pt_start.strftime("%H:00"),
                "day_label": pt_start.strftime("%H:00"),
                "completed": day_delivered,
                "failed": day_failed,
                "created": day_created,
            })
    elif range_ == "30d":
        for i in range(30):
            pt_start = start_date + timedelta(days=i)
            pt_end = pt_start + timedelta(days=1)
            day_delivered = sum(1 for d in delivered if d.completed_at and pt_start <= d.completed_at < pt_end)

            day_failed = sum(
                1 for d in failed_deliveries
                if (d.completed_at and pt_start <= d.completed_at < pt_end)
                or (not d.completed_at and d.created_at and pt_start <= d.created_at < pt_end)
            )
            day_created = sum(1 for d in deliveries if d.created_at and pt_start <= d.created_at < pt_end)
            deliveries_time_series.append({
                "date": pt_start.strftime("%Y-%m-%d"),
                "day_label": pt_start.strftime("%d %b"),
                "completed": day_delivered,
                "failed": day_failed,
                "created": day_created,
            })
    else:
        for i in range(7):
            pt_start = start_date + timedelta(days=i)
            pt_end = pt_start + timedelta(days=1)
            day_delivered = sum(1 for d in delivered if d.completed_at and pt_start <= d.completed_at < pt_end)

            day_failed = sum(
                1 for d in failed_deliveries
                if (d.completed_at and pt_start <= d.completed_at < pt_end)
                or (not d.completed_at and d.created_at and pt_start <= d.created_at < pt_end)
            )
            day_created = sum(1 for d in deliveries if d.created_at and pt_start <= d.created_at < pt_end)
            deliveries_time_series.append({
                "date": pt_start.strftime("%Y-%m-%d"),
                "day_label": pt_start.strftime("%a"),
                "completed": day_delivered,
                "failed": day_failed,
                "created": day_created,
            })


    package_breakdown: dict[str, int] = defaultdict(int)
    for d in delivered:
        package_breakdown[d.package_type or "standard"] += 1


    priority_breakdown: dict[str, int] = defaultdict(int)
    for d in deliveries:
        priority_breakdown[d.priority or "normal"] += 1

    return {

        "total_deliveries": total_deliveries,
        "active_deliveries": len(active_deliveries),
        "pending_deliveries": len(pending_deliveries),
        "successful_deliveries": success_count,
        "failed_deliveries": fail_count,
        "cancelled_deliveries": cancel_count,
        "success_rate_pct": success_rate,
        "completed_today": completed_today,
        "completed_this_week": completed_this_week,
        "failed_today": failed_today,
        "avg_delivery_time_h": avg_delivery_time_h,
        "avg_distance_km": avg_distance_km,
        "total_distance_km": total_distance_km,
        "avg_weight_kg": avg_weight_kg,

        "total_missions": len(missions),
        "completed_missions": len(completed_missions),
        "failed_missions": len(failed_missions),
        "aborted_missions": len(aborted_missions),
        "avg_mission_duration_h": avg_mission_duration_h,
        "avg_mission_distance_km": avg_mission_distance_km,
        "total_charging_stops": total_charging_stops,
        "weather_hold_count": weather_hold_count,
        "avg_battery_consumption_pct": avg_battery_consumption_pct,

        "total_drones": total_drones,
        "active_drones": active_drones,
        "charging_drones": charging_drones,
        "idle_drones": idle_drones,
        "utilization_pct": utilization_pct,
        "avg_flight_km_per_drone": avg_flight_km_per_drone,
        "total_fleet_km": total_fleet_km,
        "avg_battery_health": avg_battery_health,
        "total_charge_cycles": total_charge_cycles,
        "most_used_drone": most_used_drone,

        "failed_by_cause": dict(failed_by_cause),
        "package_breakdown": dict(package_breakdown),
        "priority_breakdown": dict(priority_breakdown),
        "deliveries_time_series": deliveries_time_series,
        "drone_leaderboard": drone_leaderboard,
    }


@router.get("/{delivery_id}", response_model=DeliveryResponse)
def get_delivery(
    delivery_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Gets a delivery by ID.
    Checks ownership - customer sees only their own delivery.
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    

    if not can_view_delivery(db, current_user, delivery):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to view this delivery"
        )
    
    return delivery


@router.patch("/{delivery_id}/status", status_code=status.HTTP_200_OK)
def update_delivery(
    delivery_id: int,
    status_payload: DeliveryStatusUpdateRequest | None = Body(default=None),
    new_status: str | None = Query(default=None),
    payload: dict = Depends(require_role("dispatcher", "admin")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Updates the status of a delivery.
    Valid status: pending, assigned, in_progress, delivered, failed
    Accessible: dispatcher, admin
    """
    requested_status = new_status
    if status_payload:
        requested_status = (
            status_payload.new_status
            or status_payload.status
            or requested_status
        )

    if not requested_status:
        raise HTTPException(
            status_code=400,
            detail="Missing status. Send `new_status` (or `status`) in JSON body or query"
        )

    valid_statuses = [s.value for s in DeliveryStatus]
    if requested_status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of {valid_statuses}"
        )

    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")

    try:
        success = update_delivery_status(db, delivery_id, requested_status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not success:
        raise HTTPException(status_code=400, detail="Could not update delivery status")

    return {"message": f"Delivery status updated to {requested_status}"}


@router.get("/{delivery_id}/track", response_model=dict)
def track_delivery(
    delivery_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Live tracking for an active delivery.
    Returns: drone position, progress, ETA, route, battery.
    Customer can see only their own deliveries.
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")

    if not can_view_delivery(db, current_user, delivery):
        raise HTTPException(status_code=403, detail="Access denied")

    result = {
        "delivery_id": delivery.id,
        "status": delivery.status,
        "priority": delivery.priority,
        "package_type": delivery.package_type,
        "pickup_lat": delivery.pickup_lat,
        "pickup_lon": delivery.pickup_lon,
        "dest_lat": delivery.dest_lat,
        "dest_lon": delivery.dest_lon,
        "pickup_address": getattr(delivery, "pickup_address", None),
        "dest_address": getattr(delivery, "dest_address", None),
        "estimated_distance_km": delivery.estimated_distance_km,
        "estimated_duration_h": delivery.estimated_duration_h,
        "created_at": delivery.created_at.isoformat() if delivery.created_at else None,
        "completed_at": delivery.completed_at.isoformat() if delivery.completed_at else None,
        "failure_reason": delivery.failure_reason,
        "dropoff_safety_status": getattr(delivery, "dropoff_safety_status", None),
        "dropoff_safety_reason": getattr(delivery, "dropoff_safety_reason", None),
        "dropoff_weather_safe": getattr(delivery, "dropoff_weather_safe", None),
        "dropoff_battery_pct": getattr(delivery, "dropoff_battery_pct", None),
        "dropoff_distance_m": getattr(delivery, "dropoff_distance_m", None),
        "dropoff_code_required": getattr(delivery, "dropoff_code_required", None),
        "confirmed_at": delivery.confirmed_at.isoformat() if delivery.confirmed_at else None,
        "drone": None,
        "mission": None,
        "weather": None,
    }

    if delivery.drone_id:
        drone = db.query(Drone).filter(Drone.id == delivery.drone_id).first()
        if drone:

            from backend.services.weather_service import get_weather_impact_at
            _speed_mult = 1.0
            if drone.latitude is not None and drone.longitude is not None:
                try:
                    _wx = get_weather_impact_at(float(drone.latitude), float(drone.longitude))
                    _speed_mult = max(0.1, _wx.get("speed_multiplier", 1.0))
                except Exception:
                    pass
            
            from backend.services.battery_service import compute_effective_speed
            drone_weight = float(drone.weight_kg) if drone.weight_kg is not None else 3.5
            payload_weight = float(delivery.weight_kg) if delivery.weight_kg is not None else 0.0
            
            _speed = compute_effective_speed(
                weight_kg=drone_weight + payload_weight,
                weather_speed_mult=_speed_mult
            ) if drone.status in ("in_mission", "going_to_charging") else 0.0

            result["drone"] = {
                "id": drone.id,
                "name": drone.name,
                "latitude": float(drone.latitude) if drone.latitude is not None else None,
                "longitude": float(drone.longitude) if drone.longitude is not None else None,
                "battery": round(float(drone.battery), 1) if drone.battery is not None else 0,
                "status": drone.status,
                "route_path": (
                    json.loads(drone.route_path) if isinstance(drone.route_path, str)
                    else drone.route_path
                ) if drone.route_path else None,
                "route_index": int(drone.route_index) if drone.route_index else 0,
                "charge_count": int(drone.charge_count) if drone.charge_count else 0,
                "battery_health": round(float(drone.battery_health), 1) if drone.battery_health is not None else 100,
                "speed": _speed,
            }

            if drone.latitude is not None and drone.longitude is not None:
                try:
                    from backend.services.weather_service import get_weather_at
                    w = get_weather_at(float(drone.latitude), float(drone.longitude))
                    result["weather"] = {
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
                        "source": w.get("source", ""),
                    }
                except Exception:
                    pass

        mission = db.query(Mission).filter(
            Mission.delivery_id == delivery.id,
            Mission.end_time == None,
        ).order_by(Mission.start_time.desc()).first()
        if mission:
            result["mission"] = {
                "id": mission.id,
                "progress_pct": round(float(mission.progress_pct), 1) if mission.progress_pct else 0,
                "remaining_km": round(float(mission.remaining_km), 2) if mission.remaining_km else None,
                "remaining_duration_h": round(float(mission.remaining_duration_h), 4) if mission.remaining_duration_h else None,
                "total_distance_km": round(float(mission.total_distance_km), 2) if mission.total_distance_km else None,
                "estimated_distance_km": round(float(mission.estimated_distance_km), 2) if mission.estimated_distance_km else None,
                "status": mission.status,
                "start_time": mission.start_time.isoformat() if mission.start_time else None,
                "pickup_waypoint_index": mission.pickup_waypoint_index,

                "remaining_km_to_pickup": round(float(mission.remaining_km_to_pickup), 3) if mission.remaining_km_to_pickup is not None else None,
                "remaining_km_to_destination": round(float(mission.remaining_km_to_destination), 3) if mission.remaining_km_to_destination is not None else None,

                "eta_sim_s_to_pickup": (
                    round(mission.remaining_km_to_pickup / SIM_DRONE_SPEED_KM_PER_TICK)
                    if mission.remaining_km_to_pickup is not None else None
                ),
                "eta_sim_s_to_destination": (
                    round(mission.remaining_km_to_destination / SIM_DRONE_SPEED_KM_PER_TICK)
                    if mission.remaining_km_to_destination is not None else None
                ),

                "eta_real_h_to_pickup": (
                    round(mission.remaining_km_to_pickup / 60.0, 4)
                    if mission.remaining_km_to_pickup is not None else None
                ),
                "eta_real_h_to_destination": (
                    round(mission.remaining_km_to_destination / 60.0, 4)
                    if mission.remaining_km_to_destination is not None else None
                ),
            }

    return result


@router.get("/{delivery_id}/timeline", response_model=DeliveryTimeline)
def get_delivery_timeline(
    delivery_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Complete timeline of a delivery, built from mission events.

    Returns:
    - steps: main steps (created, assigned, departure, pickup, transit, delivered/cancelled/failed)
      each with timestamp, completed, active
    - events: secondary events (charging stops, weather holds, flight resumptions)

    Accessible: customer (own delivery), dispatcher, admin.
    """
    delivery = get_delivery_by_id(db, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")

    if not can_view_delivery(db, current_user, delivery):
        raise HTTPException(status_code=403, detail="Access denied")

    return build_delivery_timeline(db, delivery)
