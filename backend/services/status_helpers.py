"""
Common helpers for counting and grouping by status.
Eliminates the repeated pattern len([d for d in list if d.status == ...])
from all dashboards and statistics endpoints.
"""
from typing import Any, Dict, Iterable, Optional


def count_by_status(items: Iterable[Any], status_field: str = "status") -> Dict[str, int]:
    """
    Groups a collection of objects by the status field and returns
    a dict {status: count}.

    Example:
        counts = count_by_status(deliveries)
        counts["pending"]  # → 3
    """
    result: Dict[str, int] = {}
    for item in items:
        val = getattr(item, status_field, None) or "unknown"
        result[val] = result.get(val, 0) + 1
    return result


def count_where(items: Iterable[Any], statuses: Iterable[str], field: str = "status") -> int:
    """
    Counts how many objects have a status in the `statuses` set.

    Example:
        n = count_where(deliveries, {"pending", "created"})
    """
    status_set = frozenset(statuses)
    return sum(1 for item in items if getattr(item, field, None) in status_set)


def delivery_status_summary(deliveries: Iterable[Any], *, assignable: frozenset, in_transit: frozenset) -> Dict[str, int]:
    """
    Returns a dict with all standard counts for a list of deliveries.
    The returned fields are those used in dashboards and analytics.
    """
    items = list(deliveries)
    return {
        "total": len(items),
        "pending": count_where(items, assignable),
        "assigned": count_where(items, {"assigned"}),
        "picking_up": count_where(items, {"picking_up"}),
        "in_transit": count_where(items, in_transit),
        "delivered": sum(1 for d in items if getattr(d, "status", None) == "delivered" and getattr(d, "confirmed_at", None) is None),
        "confirmed": sum(1 for d in items if getattr(d, "status", None) == "delivered" and getattr(d, "confirmed_at", None) is not None),
        "cancelled": count_where(items, {"cancelled"}),
        "failed": count_where(items, {"failed"}),
    }
