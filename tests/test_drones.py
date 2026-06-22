"""
Tests for drone endpoints: list, get, create.
"""
import pytest
from backend.database import SessionLocal
from backend.models.delivery import Delivery
from backend.models.drone import Drone
from backend.models.mission import Mission
from backend.models.user import User
from tests.conftest import login, bearer


class TestDroneList:
    """GET /drones/"""

    def test_admin_lists_all_drones(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.get("/drones/", headers=bearer(token))
        assert resp.status_code == 200
        drones = resp.json()
        assert isinstance(drones, list)
        assert len(drones) >= 2

    def test_customer_can_list_drones(self, client):
        token = login(client, "customer-auth-test@example.com")
        resp = client.get("/drones/", headers=bearer(token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_unauthenticated_rejected(self, client):
        resp = client.get("/drones/")
        assert resp.status_code == 401


class TestDroneGetById:
    """GET /drones/{id}"""

    def test_admin_gets_drone_by_id(self, client):
        token = login(client, "admin-auth-test@example.com")

        drones = client.get("/drones/", headers=bearer(token)).json()
        if drones:
            drone_id = drones[0]["id"]
            resp = client.get(f"/drones/{drone_id}", headers=bearer(token))
            assert resp.status_code == 200
            assert resp.json()["id"] == drone_id

    def test_nonexistent_drone_404(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.get("/drones/99999", headers=bearer(token))
        assert resp.status_code == 404


class TestDroneBatteryFields:
    """Verify battery-related fields are returned"""

    def test_drone_has_battery_fields(self, client):
        token = login(client, "admin-auth-test@example.com")
        drones = client.get("/drones/", headers=bearer(token)).json()
        if drones:
            d = drones[0]
            assert "battery" in d
            assert "battery_health" in d or "estimated_range_km" in d


class TestFleetStatus:
    """GET /drones/fleet-status"""

    def test_fleet_status_active_mission_overrides_idle_status(self, client):
        token = login(client, "admin-auth-test@example.com")
        db = SessionLocal()
        drone = None
        delivery = None
        mission = None
        try:
            customer = db.query(User).filter(User.email == "customer-auth-test@example.com").first()
            assert customer is not None

            drone = Drone(
                name="Drone-Fleet-Status-Test",
                latitude=46.80,
                longitude=23.65,
                battery=88,
                status="idle",
            )
            db.add(drone)
            db.commit()
            db.refresh(drone)

            delivery = Delivery(
                customer_id=customer.id,
                pickup_lat=46.76,
                pickup_lon=23.61,
                dest_lat=46.79,
                dest_lon=23.64,
                status="assigned",
                drone_id=drone.id,
                estimated_distance_km=5.0,
                estimated_duration_h=0.2,
            )
            db.add(delivery)
            db.commit()
            db.refresh(delivery)

            mission = Mission(
                drone_id=drone.id,
                delivery_id=delivery.id,
                status="planned",
                progress_pct=37.5,
                remaining_km=3.2,
            )
            db.add(mission)
            db.commit()

            resp = client.get("/drones/fleet-status", headers=bearer(token))
            assert resp.status_code == 200

            data = resp.json()
            fleet_drone = next(d for d in data["drones"] if d["id"] == drone.id)
            assert fleet_drone["mission"]["id"] == mission.id
            assert fleet_drone["status"] == "in_mission"
            assert data["summary"]["by_status"]["in_mission"] >= 1
        finally:
            if mission is not None:
                db.delete(mission)
            if delivery is not None:
                db.delete(delivery)
            if drone is not None:
                db.delete(drone)
            db.commit()
            db.close()
