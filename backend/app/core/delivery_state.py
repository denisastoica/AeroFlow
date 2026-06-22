from enum import Enum


class DeliveryStatus(str, Enum):
    """Detailed status for the delivery lifecycle."""
    CREATED = "created"
    PENDING = "pending"
    ASSIGNED = "assigned"
    PICKING_UP = "picking_up"
    PICKED_UP = "picked_up"
    IN_TRANSIT = "in_transit"
    IN_PROGRESS = "in_progress"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"
    FAILED = "failed"


class MissionStatus(str, Enum):
    """Detailed status for drone missions."""
    PLANNED = "planned"
    PENDING = "pending"
    EN_ROUTE_PICKUP = "en_route_pickup"
    AT_PICKUP = "at_pickup"
    EN_ROUTE_DELIVERY = "en_route_delivery"
    IN_PROGRESS = "in_progress"
    CHARGING = "charging"
    PAUSED = "paused"
    COMPLETED = "completed"
    ABORTED = "aborted"
    FAILED = "failed"


ALLOWED_TRANSITIONS = {
    DeliveryStatus.CREATED:     [DeliveryStatus.ASSIGNED, DeliveryStatus.CANCELLED, DeliveryStatus.FAILED],
    DeliveryStatus.PENDING:     [DeliveryStatus.ASSIGNED, DeliveryStatus.CANCELLED, DeliveryStatus.FAILED],
    DeliveryStatus.ASSIGNED:    [DeliveryStatus.PICKING_UP, DeliveryStatus.PENDING, DeliveryStatus.CANCELLED, DeliveryStatus.FAILED],
    DeliveryStatus.PICKING_UP:  [DeliveryStatus.PICKED_UP, DeliveryStatus.PENDING, DeliveryStatus.CANCELLED, DeliveryStatus.FAILED],
    DeliveryStatus.PICKED_UP:   [DeliveryStatus.IN_TRANSIT, DeliveryStatus.PENDING, DeliveryStatus.CANCELLED, DeliveryStatus.FAILED],
    DeliveryStatus.IN_TRANSIT:  [DeliveryStatus.DELIVERED, DeliveryStatus.PENDING, DeliveryStatus.CANCELLED, DeliveryStatus.FAILED],
    DeliveryStatus.IN_PROGRESS: [DeliveryStatus.DELIVERED, DeliveryStatus.PENDING, DeliveryStatus.CANCELLED, DeliveryStatus.FAILED],
    DeliveryStatus.DELIVERED:   [],
    DeliveryStatus.CANCELLED:   [],
    DeliveryStatus.FAILED:      [DeliveryStatus.PENDING],
}


ALLOWED_MISSION_TRANSITIONS = {
    MissionStatus.PLANNED:            [MissionStatus.EN_ROUTE_PICKUP, MissionStatus.FAILED, MissionStatus.ABORTED],
    MissionStatus.PENDING:            [MissionStatus.EN_ROUTE_PICKUP, MissionStatus.FAILED, MissionStatus.ABORTED],
    MissionStatus.EN_ROUTE_PICKUP:    [MissionStatus.AT_PICKUP, MissionStatus.CHARGING, MissionStatus.FAILED, MissionStatus.ABORTED],
    MissionStatus.AT_PICKUP:          [MissionStatus.EN_ROUTE_DELIVERY, MissionStatus.FAILED, MissionStatus.ABORTED],
    MissionStatus.EN_ROUTE_DELIVERY:  [MissionStatus.COMPLETED, MissionStatus.CHARGING, MissionStatus.FAILED, MissionStatus.ABORTED],
    MissionStatus.IN_PROGRESS:        [MissionStatus.COMPLETED, MissionStatus.CHARGING, MissionStatus.FAILED, MissionStatus.ABORTED],
    MissionStatus.CHARGING:           [MissionStatus.EN_ROUTE_PICKUP, MissionStatus.EN_ROUTE_DELIVERY, MissionStatus.FAILED, MissionStatus.ABORTED],
    MissionStatus.COMPLETED:          [],
    MissionStatus.ABORTED:            [],
    MissionStatus.FAILED:             [],
}


ACTIVE_DELIVERY_STATUSES = frozenset({
    DeliveryStatus.ASSIGNED.value,
    DeliveryStatus.PICKING_UP.value,
    DeliveryStatus.PICKED_UP.value,
    DeliveryStatus.IN_TRANSIT.value,
    DeliveryStatus.IN_PROGRESS.value,
})


ASSIGNABLE_DELIVERY_STATUSES = frozenset({
    DeliveryStatus.PENDING.value,
    DeliveryStatus.CREATED.value,
})


IN_TRANSIT_STATUSES = frozenset({
    DeliveryStatus.IN_TRANSIT.value,
    DeliveryStatus.PICKED_UP.value,
    DeliveryStatus.IN_PROGRESS.value,
})


TERMINAL_DELIVERY_STATUSES = frozenset({
    DeliveryStatus.DELIVERED.value,
    DeliveryStatus.CANCELLED.value,
    DeliveryStatus.FAILED.value,
})


ACTIVE_MISSION_STATUSES = frozenset({
    MissionStatus.PLANNED.value,
    MissionStatus.PENDING.value,
    MissionStatus.EN_ROUTE_PICKUP.value,
    MissionStatus.AT_PICKUP.value,
    MissionStatus.EN_ROUTE_DELIVERY.value,
    MissionStatus.IN_PROGRESS.value,
    MissionStatus.CHARGING.value,
    MissionStatus.PAUSED.value,
})


TERMINAL_MISSION_STATUSES = frozenset({
    MissionStatus.COMPLETED.value,
    MissionStatus.ABORTED.value,
    MissionStatus.FAILED.value,
})


def get_delivery_status(status_str: str) -> DeliveryStatus:
    """Convert string → DeliveryStatus enum (safe)."""
    try:
        return DeliveryStatus(status_str)
    except ValueError:
        raise ValueError(f"Unknown delivery status: {status_str}")


def get_mission_status(status_str: str) -> MissionStatus:
    """Convert string → MissionStatus enum (safe)."""
    try:
        return MissionStatus(status_str)
    except ValueError:
        raise ValueError(f"Unknown mission status: {status_str}")


def can_transition(current_status: DeliveryStatus, new_status: DeliveryStatus) -> bool:
    """Checks if delivery transition is allowed."""
    return new_status in ALLOWED_TRANSITIONS.get(current_status, [])


def can_mission_transition(current_status: MissionStatus, new_status: MissionStatus) -> bool:
    """Checks if mission transition is allowed."""
    return new_status in ALLOWED_MISSION_TRANSITIONS.get(current_status, [])


def update_delivery_status(delivery, new_status: DeliveryStatus):
    """Updates delivery status after validating the transition."""
    current_status = get_delivery_status(delivery.status)
    if not can_transition(current_status, new_status):
        raise ValueError(
            f"Invalid transition: {current_status.value} → {new_status.value}"
        )
    delivery.status = new_status.value
