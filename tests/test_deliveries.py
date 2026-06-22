"""
Tests for delivery CRUD, assignment, and dashboard endpoints.
"""
import pytest
from tests.conftest import login, bearer
from backend.database import SessionLocal
from backend.models.drone import Drone
from backend.models.delivery import Delivery
from backend.models.mission import Mission
from backend.models.mission_event import MissionEvent


class TestDeliveryCreate:
    """POST /deliveries/"""

    def test_customer_creates_delivery(self, client):
        token = login(client, "customer-auth-test@example.com")
        resp = client.post("/deliveries/", json={
            "pickup_lat": 46.77,
            "pickup_lon": 23.59,
            "dest_lat": 46.80,
            "dest_lon": 23.65,
            "priority": "normal",
            "package_type": "standard",
            "weight_kg": 2.0,
        }, headers=bearer(token))
        assert resp.status_code in (200, 201)
        data = resp.json()
        assert data["status"] in ("pending", "assigned")
        assert data["priority"] == "normal"

    def test_invalid_priority_rejected(self, client):
        token = login(client, "customer-auth-test@example.com")
        resp = client.post("/deliveries/", json={
            "pickup_lat": 46.77,
            "pickup_lon": 23.59,
            "dest_lat": 46.80,
            "dest_lon": 23.65,
            "priority": "super_urgent",
            "weight_kg": 1.0,
        }, headers=bearer(token))
        assert resp.status_code == 422

    def test_invalid_coordinates_rejected(self, client):
        token = login(client, "customer-auth-test@example.com")
        resp = client.post("/deliveries/", json={
            "pickup_lat": 999,
            "pickup_lon": 23.59,
            "dest_lat": 46.80,
            "dest_lon": 23.65,
        }, headers=bearer(token))
        assert resp.status_code == 422

    def test_overweight_rejected(self, client):
        token = login(client, "customer-auth-test@example.com")
        resp = client.post("/deliveries/", json={
            "pickup_lat": 46.77,
            "pickup_lon": 23.59,
            "dest_lat": 46.80,
            "dest_lon": 23.65,
            "weight_kg": 30.0,
        }, headers=bearer(token))
        assert resp.status_code == 422

    def test_zero_weight_rejected(self, client):
        token = login(client, "customer-auth-test@example.com")
        resp = client.post("/deliveries/", json={
            "pickup_lat": 46.77,
            "pickup_lon": 23.59,
            "dest_lat": 46.80,
            "dest_lon": 23.65,
            "weight_kg": 0,
        }, headers=bearer(token))
        assert resp.status_code == 422

    def test_unauthenticated_rejected(self, client):
        resp = client.post("/deliveries/", json={
            "pickup_lat": 46.77,
            "pickup_lon": 23.59,
            "dest_lat": 46.80,
            "dest_lon": 23.65,
        })
        assert resp.status_code == 401

    def test_emergency_delivery(self, client):
        token = login(client, "customer-auth-test@example.com")
        resp = client.post("/deliveries/", json={
            "pickup_lat": 46.77,
            "pickup_lon": 23.59,
            "dest_lat": 46.80,
            "dest_lon": 23.65,
            "priority": "emergency",
            "package_type": "medical",
            "notes": "Insulină urgentă",
            "weight_kg": 0.5,
        }, headers=bearer(token))
        assert resp.status_code in (200, 201)
        data = resp.json()
        assert data["priority"] == "emergency"
        assert data["package_type"] == "medical"


class TestDeliveryList:
    """GET /deliveries/"""

    def test_customer_sees_own_deliveries(self, client):
        token = login(client, "customer-auth-test@example.com")
        resp = client.get("/deliveries/", headers=bearer(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert isinstance(data["items"], list)

    def test_dispatcher_sees_all(self, client):
        token = login(client, "dispatcher-auth-test@example.com")
        resp = client.get("/deliveries/", headers=bearer(token))
        assert resp.status_code == 200
        assert "items" in resp.json()

    def test_admin_sees_all(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.get("/deliveries/", headers=bearer(token))
        assert resp.status_code == 200
        assert "items" in resp.json()


class TestDeliveryDashboard:
    """GET /deliveries/dashboard/customer, /deliveries/dashboard/dispatcher"""

    def test_customer_dashboard(self, client):
        token = login(client, "customer-auth-test@example.com")
        resp = client.get("/deliveries/dashboard/customer", headers=bearer(token))
        assert resp.status_code == 200

    def test_dispatcher_dashboard(self, client):
        token = login(client, "dispatcher-auth-test@example.com")
        resp = client.get("/deliveries/dashboard/dispatcher", headers=bearer(token))
        assert resp.status_code == 200


class TestCustomerConfirmationFlow:
    def test_confirmation_updates_dashboard_and_proof(self, client):
        customer_token = login(client, "customer-auth-test@example.com")
        dispatcher_token = login(client, "dispatcher-auth-test@example.com")

        create_resp = client.post("/deliveries/", json={
            "pickup_lat": 46.7701,
            "pickup_lon": 23.5901,
            "dest_lat": 46.8002,
            "dest_lon": 23.6502,
            "priority": "normal",
            "package_type": "medical",
            "weight_kg": 1.5,
        }, headers=bearer(customer_token))
        assert create_resp.status_code in (200, 201), create_resp.text
        delivery_id = create_resp.json()["id"]

        db = SessionLocal()
        try:
            delivery = db.query(Delivery).filter(Delivery.id == delivery_id).first()
            assert delivery is not None
            delivery.status = "in_transit"
            db.commit()
        finally:
            db.close()

        mark_delivered_resp = client.patch(
            f"/deliveries/{delivery_id}/status",
            json={"new_status": "delivered"},
            headers=bearer(dispatcher_token),
        )
        assert mark_delivered_resp.status_code == 200, mark_delivered_resp.text

        db = SessionLocal()
        try:
            delivery = db.query(Delivery).filter(Delivery.id == delivery_id).first()
            assert delivery is not None
            assert delivery.confirmation_code is not None
            confirmation_code = delivery.confirmation_code
        finally:
            db.close()

        before = client.get("/deliveries/dashboard/customer", headers=bearer(customer_token))
        assert before.status_code == 200, before.text
        before_data = before.json()
        before_delivery = next((d for d in before_data["recent_deliveries"] if d["id"] == delivery_id), None)
        assert before_delivery is not None
        assert before_delivery["confirmed_at"] is None

        confirm_resp = client.post(f"/deliveries/{delivery_id}/confirm", json={
            "confirmation_code": confirmation_code,
            "recipient_name": "Customer Test",
            "delivery_photo_url": "https://example.com/proof.jpg",
            "delivery_notes": "Package arrived intact.",
        })
        assert confirm_resp.status_code == 200, confirm_resp.text

        after = client.get("/deliveries/dashboard/customer", headers=bearer(customer_token))
        assert after.status_code == 200, after.text
        after_data = after.json()
        after_delivery = next((d for d in after_data["recent_deliveries"] if d["id"] == delivery_id), None)
        assert after_delivery is not None
        assert after_delivery["confirmed_at"] is not None
        assert after_data["confirmed"] == before_data["confirmed"] + 1
        assert after_data["delivered"] == before_data["delivered"] - 1

        proof_resp = client.get(f"/deliveries/{delivery_id}/proof", headers=bearer(customer_token))
        assert proof_resp.status_code == 200, proof_resp.text
        proof = proof_resp.json()
        assert proof["confirmation_code"] == confirmation_code
        assert proof["recipient_name"] == "Customer Test"
        assert proof["confirmed_at"] is not None
        assert proof["delivery_photo_url"] == "https://example.com/proof.jpg"
        assert proof["delivery_notes"] == "Package arrived intact."


class TestDeliveryDiagnostics:
    def test_assignment_diagnostics_returns_primary_reason_and_rejected_drones(self, client):
        customer_token = login(client, "customer-auth-test@example.com")
        dispatcher_token = login(client, "dispatcher-auth-test@example.com")

        create_resp = client.post("/deliveries/", json={
            "pickup_lat": 46.7701,
            "pickup_lon": 23.5901,
            "dest_lat": 46.8002,
            "dest_lon": 23.6502,
            "priority": "normal",
            "package_type": "standard",
            "weight_kg": 1.0,
        }, headers=bearer(customer_token))
        assert create_resp.status_code in (200, 201), create_resp.text
        delivery_id = create_resp.json()["id"]

        db = SessionLocal()
        try:
            delivery = db.query(Delivery).filter(Delivery.id == delivery_id).first()
            assert delivery is not None
            delivery.status = "pending"
            delivery.drone_id = None

            drones = db.query(Drone).order_by(Drone.id.asc()).all()
            assert len(drones) >= 2
            drones[0].status = "in_mission"
            drones[0].battery = 82
            drones[1].status = "idle"
            drones[1].battery = 5
            db.commit()
        finally:
            db.close()

        resp = client.get(f"/deliveries/{delivery_id}/diagnostics", headers=bearer(dispatcher_token))
        assert resp.status_code == 200, resp.text
        data = resp.json()

        assert data["status"] == "pending"
        assert data["primary_reason"]
        assert isinstance(data["rejected_drones"], list)
        assert len(data["rejected_drones"]) >= 2

        reasons = {entry["reason"] for entry in data["rejected_drones"]}
        assert "already busy" in reasons
        assert "battery too low" in reasons
        assert all("drone_id" in entry and "drone_name" in entry for entry in data["rejected_drones"])

    def test_failure_diagnostics_returns_reason_context_and_step(self, client):
        customer_token = login(client, "customer-auth-test@example.com")
        dispatcher_token = login(client, "dispatcher-auth-test@example.com")
        affected_drone_id = None

        create_resp = client.post("/deliveries/", json={
            "pickup_lat": 46.7701,
            "pickup_lon": 23.5901,
            "dest_lat": 46.8002,
            "dest_lon": 23.6502,
            "priority": "normal",
            "package_type": "standard",
            "weight_kg": 1.0,
        }, headers=bearer(customer_token))
        assert create_resp.status_code in (200, 201), create_resp.text
        delivery_id = create_resp.json()["id"]

        db = SessionLocal()
        try:
            delivery = db.query(Delivery).filter(Delivery.id == delivery_id).first()
            drone = db.query(Drone).order_by(Drone.id.asc()).first()
            assert delivery is not None
            assert drone is not None
            affected_drone_id = drone.id

            delivery.status = "failed"
            delivery.failure_reason = "Battery too low during route"
            delivery.drone_id = drone.id

            mission = Mission(
                drone_id=drone.id,
                delivery_id=delivery.id,
                status="failed",
            )
            db.add(mission)
            db.flush()

            db.add(MissionEvent(
                mission_id=mission.id,
                event_type="MISSION_ABORTED",
                details="Mission aborted due to weather near waypoint 4.",
            ))
            db.commit()
        finally:
            db.close()

        resp = client.get(f"/deliveries/{delivery_id}/diagnostics", headers=bearer(dispatcher_token))
        assert resp.status_code == 200, resp.text
        data = resp.json()

        assert data["status"] == "failed"
        assert data["failure_reason"] == "Battery too low during route"
        assert data["what_happened"] == "The assigned drone encountered unsafe weather and the mission was aborted."
        assert data["failed_step"] == "In transit"
        assert data["affected_drone"]["id"] == affected_drone_id
        assert data["affected_drone"]["name"]
        assert data["latest_event"]["event_type"] == "MISSION_ABORTED"
        assert data["latest_event"]["label"] == "Mission failed"
        assert data["latest_event"]["is_failure_event"] is True
        assert len(data["timeline"]) == 1
        assert len(data["mission_context"]) == 1
        assert "Delivery not completed" in data["operational_impact"]
        assert data["recommendations"]


class TestDropoffSafety:
    def test_complete_delivery_with_warning_weather(self, client):
        db = SessionLocal()
        try:
            from backend.models.user import User
            from backend.models.drone import Drone
            from backend.models.delivery import Delivery
            from backend.services.drone_simulator import _complete_delivery
            from unittest.mock import patch

            user = db.query(User).filter(User.email == "customer-auth-test@example.com").first()
            assert user is not None


            drone = Drone(
                name="Test-Safety-Drone-Warning",
                status="in_mission",
                battery=80.0,
                latitude=46.77,
                longitude=23.62,
            )
            db.add(drone)
            db.flush()


            delivery = Delivery(
                customer_id=user.id,
                pickup_lat=46.77,
                pickup_lon=23.62,
                dest_lat=46.77,
                dest_lon=23.62,
                status="in_transit",
                drone_id=drone.id,
            )
            db.add(delivery)
            db.commit()


            mock_weather = {
                "condition": "rain",
                "can_fly": True,
                "wind_speed": 4.3,
                "temperature": 17.3,
            }
            with patch("backend.services.weather_service.get_weather_at", return_value=mock_weather):
                _complete_delivery(db, drone)


            db.refresh(delivery)
            db.refresh(drone)

            assert delivery.status == "delivered"
            assert delivery.dropoff_safety_status == "passed"
            assert delivery.dropoff_weather_safe == "warning"
            assert drone.status == "idle"

        finally:
            db.close()

    def test_complete_delivery_with_unsafe_weather(self, client):
        db = SessionLocal()
        try:
            from backend.models.user import User
            from backend.models.drone import Drone
            from backend.models.delivery import Delivery
            from backend.services.drone_simulator import _complete_delivery
            from unittest.mock import patch

            user = db.query(User).filter(User.email == "customer-auth-test@example.com").first()
            assert user is not None


            drone = Drone(
                name="Test-Safety-Drone-Unsafe",
                status="in_mission",
                battery=80.0,
                latitude=46.77,
                longitude=23.62,
            )
            db.add(drone)
            db.flush()


            delivery = Delivery(
                customer_id=user.id,
                pickup_lat=46.77,
                pickup_lon=23.62,
                dest_lat=46.77,
                dest_lon=23.62,
                status="in_transit",
                drone_id=drone.id,
            )
            db.add(delivery)
            db.commit()


            mock_weather = {
                "condition": "storm",
                "can_fly": False,
                "wind_speed": 34.3,
                "temperature": 12.3,
            }
            with patch("backend.services.weather_service.get_weather_at", return_value=mock_weather):
                _complete_delivery(db, drone)


            db.refresh(delivery)
            db.refresh(drone)

            assert delivery.status == "failed"
            assert delivery.failure_reason == "unsafe_dropoff_weather"
            assert delivery.dropoff_safety_status == "failed"
            assert delivery.dropoff_safety_reason == "weather unsafe"
            assert delivery.dropoff_weather_safe == "unsafe"
            assert drone.status == "idle"

        finally:
            db.close()

    def test_complete_delivery_with_safe_weather(self, client):
        db = SessionLocal()
        try:
            from backend.models.user import User
            from backend.models.drone import Drone
            from backend.models.delivery import Delivery
            from backend.services.drone_simulator import _complete_delivery
            from unittest.mock import patch

            user = db.query(User).filter(User.email == "customer-auth-test@example.com").first()
            assert user is not None


            drone = Drone(
                name="Test-Safety-Drone-Safe",
                status="in_mission",
                battery=80.0,
                latitude=46.77,
                longitude=23.62,
            )
            db.add(drone)
            db.flush()


            delivery = Delivery(
                customer_id=user.id,
                pickup_lat=46.77,
                pickup_lon=23.62,
                dest_lat=46.77,
                dest_lon=23.62,
                status="in_transit",
                drone_id=drone.id,
            )
            db.add(delivery)
            db.commit()


            mock_weather = {
                "condition": "clear",
                "can_fly": True,
                "wind_speed": 4.3,
                "temperature": 17.3,
            }
            with patch("backend.services.weather_service.get_weather_at", return_value=mock_weather):
                _complete_delivery(db, drone)


            db.refresh(delivery)
            db.refresh(drone)

            assert delivery.status == "delivered"
            assert delivery.dropoff_safety_status == "passed"
            assert delivery.dropoff_weather_safe == "safe"
            assert drone.status == "idle"

        finally:
            db.close()
