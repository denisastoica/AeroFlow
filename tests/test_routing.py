"""Tests for grid routing, no-route handling, /route API, start_mission, auto_assign."""

from unittest.mock import patch
import uuid

import bcrypt
import pytest
from fastapi.testclient import TestClient

from backend.database import SessionLocal
from backend.models.user import User
from backend.models.drone import Drone
from backend.models.delivery import Delivery
from backend.services.grid import CityGrid, simplify_polyline_lat_lon, haversine_distance
from backend.services.delivery_service import auto_assign_delivery

from tests.conftest import login, bearer


def _hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def test_a_star_no_path_returns_empty_find_route():
    """
    2×2 grid: blocking both orthogonal bridges forces diagonals to be rejected
    (corner-cutting rule), so (0,0)→(1,1) is unreachable.
    """
    g = CityGrid(min_lat=0.0, max_lat=1.0, min_lon=0.0, max_lon=1.0, rows=2, cols=2)
    blocked = {(0, 1), (1, 0)}
    path = g.find_route(0.0, 0.0, 1.0, 1.0, blocked_cells=blocked)
    assert path == []


def test_find_route_returns_polyline_when_reachable():
    g = CityGrid(min_lat=0.0, max_lat=1.0, min_lon=0.0, max_lon=1.0, rows=2, cols=2)
    path = g.find_route(0.0, 0.0, 1.0, 1.0, blocked_cells=set())
    assert len(path) >= 2
    assert path[0][0] == pytest.approx(0.0)
    assert path[0][1] == pytest.approx(0.0)
    assert path[-1][0] == pytest.approx(1.0)
    assert path[-1][1] == pytest.approx(1.0)


def test_simplify_polyline_keeps_endpoints_only_for_almost_straight_line():
    pts = [(0.0, 0.0), (0.0001, 0.0001), (0.0002, 0.0002), (0.0003, 0.0003)]
    out = simplify_polyline_lat_lon(pts, epsilon_deg=0.00045)
    assert len(out) == 2
    assert out[0] == pts[0]
    assert out[-1] == pts[-1]


def test_compute_route_422_when_no_safe_path(client: TestClient):
    with patch("backend.routes.routing.get_blocked_cells", return_value=set()):
        with patch("backend.routes.routing.plan_route_leg", return_value=[]):
            r = client.post(
                "/route/",
                json={
                    "start_lat": 46.77,
                    "start_lon": 23.62,
                    "end_lat": 46.79,
                    "end_lon": 23.64,
                },
            )
    assert r.status_code == 422
    detail = r.json()["detail"].lower()
    assert "route" in detail or "safe" in detail or "sigur" in detail or "rut" in detail


def test_compute_route_ok_when_path_exists(client: TestClient):
    fake = [(46.77, 23.62), (46.775, 23.625), (46.78, 23.63)]
    with patch("backend.routes.routing.get_blocked_cells", return_value=set()):
        with patch("backend.routes.routing.plan_route_leg", return_value=fake):
            r = client.post(
                "/route/",
                json={
                    "start_lat": 46.77,
                    "start_lon": 23.62,
                    "end_lat": 46.78,
                    "end_lon": 23.63,
                },
            )
    assert r.status_code == 200
    body = r.json()
    assert len(body["path"]) >= 2
    expected = round(
        haversine_distance(fake[0][0], fake[0][1], fake[1][0], fake[1][1])
        + haversine_distance(fake[1][0], fake[1][1], fake[2][0], fake[2][1]),
        2,
    )
    assert body["distance_km"] == expected


def test_start_mission_400_when_server_cannot_compute_route(client: TestClient):
    tok = login(client, "dispatcher-auth-test@example.com")


    db = SessionLocal()
    uid = uuid.uuid4().hex[:8]
    test_drone = Drone(
        name=f"Route-Test-Drone-{uid}",
        latitude=46.77,
        longitude=23.62,
        battery=100.0,
        status="idle",
    )
    db.add(test_drone)
    db.commit()
    db.refresh(test_drone)
    drone_id = test_drone.id
    db.close()

    try:
        with patch("backend.routes.drones.get_blocked_cells", return_value=set()):
            with patch("backend.routes.drones.plan_route_leg", return_value=[]):
                r = client.post(
                    f"/drones/{drone_id}/start_mission",
                    headers=bearer(tok),
                    json={"path": [[46.77, 23.62], [46.79, 23.64]]},
                )
        assert r.status_code == 400
        detail = r.json()["detail"].lower()
        assert "route" in detail or "safe" in detail or "sigur" in detail or "rut" in detail
    finally:

        db2 = SessionLocal()
        db2.query(Drone).filter(Drone.id == drone_id).delete()
        db2.commit()
        db2.close()


def test_auto_assign_false_when_destination_leg_has_no_route():
    db = SessionLocal()
    uid = uuid.uuid4().hex[:12]
    email = f"routing-assign-{uid}@example.com"
    drone_name = f"Routing-Drone-{uid}"
    deliv_id = drone_id = user_id = None
    try:
        u = User(
            email=email,
            hashed_password=_hash("Pass123!"),
            name="Routing Assign",
            role="customer",
            is_active=True,
        )
        db.add(u)
        db.commit()
        db.refresh(u)
        user_id = u.id

        d = Drone(
            name=drone_name,
            latitude=46.77,
            longitude=23.62,
            battery=100.0,
            status="idle",
        )
        db.add(d)
        db.commit()
        db.refresh(d)
        drone_id = d.id


        db.query(Drone).filter(Drone.id != drone_id).update({"status": "maintenance"})
        db.commit()

        deliv = Delivery(
            customer_id=u.id,
            pickup_lat=46.76,
            pickup_lon=23.61,
            dest_lat=46.79,
            dest_lon=23.64,
            status="pending",
            estimated_distance_km=5.0,
            estimated_duration_h=0.2,
        )
        db.add(deliv)
        db.commit()
        db.refresh(deliv)
        deliv_id = deliv.id

        leg1 = [(46.77, 23.62), (46.76, 23.61)]
        with patch("backend.services.delivery_service.get_blocked_cells", return_value=set()):
            with patch("backend.services.delivery_service.plan_route_leg") as mock_fr:

                mock_fr.side_effect = [leg1, []] * 15
                ok = auto_assign_delivery(db, deliv)

        assert ok is False
        db.refresh(deliv)
        assert deliv.status == "pending"
        assert deliv.drone_id is None
    finally:
        try:
            if deliv_id is not None:
                db.query(Delivery).filter(Delivery.id == deliv_id).delete(synchronize_session=False)
            if drone_id is not None:
                db.query(Drone).filter(Drone.id == drone_id).delete(synchronize_session=False)
            if user_id is not None:
                db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
            db.commit()
        except Exception:
            db.rollback()
        db.close()
