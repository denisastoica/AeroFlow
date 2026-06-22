"""
Tests for operational controls: Alerts, Audit, Proof of Delivery, and Mission Control.
"""
import pytest
from tests.conftest import login, bearer

class TestAlerts:
    def test_list_alerts(self, client):
        token = login(client, "dispatcher-auth-test@example.com")
        resp = client.get("/alerts/", headers=bearer(token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_alerts_summary(self, client):
        token = login(client, "dispatcher-auth-test@example.com")
        resp = client.get("/alerts/summary", headers=bearer(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "total_new" in data

class TestAudit:
    def test_list_audit(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.get("/audit/logs", headers=bearer(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data

class TestProofOfDelivery:
    def test_confirm_delivery_flow(self, client):

        token_cust = login(client, "customer-auth-test@example.com")
        token_disp = login(client, "dispatcher-auth-test@example.com")
        resp = client.post("/deliveries/", json={
            "pickup_lat": 46.77,
            "pickup_lon": 23.59,
            "dest_lat": 46.80,
            "dest_lon": 23.65,
            "package_type": "standard",
            "weight_kg": 1.0
        }, headers=bearer(token_cust))
        delivery_id = resp.json()["id"]

        code = resp.json()["confirmation_code"]
        assert code is None, "confirmation_code should not be exposed at creation"

        assign_resp = client.post(f"/deliveries/{delivery_id}/assign", headers=bearer(token_disp))
        assert assign_resp.status_code == 200, assign_resp.text

        detail_resp = client.get(f"/deliveries/{delivery_id}", headers=bearer(token_cust))
        assert detail_resp.status_code == 200, detail_resp.text
        code = detail_resp.json()["confirmation_code"]
        assert code is not None, "confirmation_code should be generated once the delivery is assigned"


        resp = client.post(f"/deliveries/{delivery_id}/confirm", json={
            "confirmation_code": code,
            "recipient_name": "Test Recipient"
        })
        assert resp.status_code == 400

class TestMissionControl:
    def test_force_cancel(self, client):
        token_admin = login(client, "admin-auth-test@example.com")

        resp = client.get("/deliveries/?status=assigned", headers=bearer(token_admin))
        items = resp.json()["items"]
        if items:
            delivery_id = items[0]["id"]
            resp = client.patch(f"/deliveries/{delivery_id}/force-cancel", headers=bearer(token_admin))
            assert resp.status_code == 200
            assert resp.json()["status"] == "cancelled"

    def test_manual_reassign(self, client):
        from backend.database import SessionLocal
        from backend.models.drone import Drone
        import uuid
        
        token_admin = login(client, "admin-auth-test@example.com")
        
        db = SessionLocal()
        test_drone = Drone(name=f"Ops-Drone-{uuid.uuid4().hex[:8]}", latitude=46.77, longitude=23.59, battery=100.0, status="idle")
        db.add(test_drone)
        db.commit()
        db.refresh(test_drone)
        drone_id = test_drone.id
        db.close()


        resp = client.post("/deliveries/", json={
            "pickup_lat": 46.77, "pickup_lon": 23.59,
            "dest_lat": 46.80, "dest_lon": 23.65,
            "weight_kg": 1.0
        }, headers=bearer(token_admin))
        delivery_id = resp.json()["id"]

        resp = client.post(f"/deliveries/{delivery_id}/reassign", json={
            "drone_id": drone_id
        }, headers=bearer(token_admin))
        assert resp.status_code == 200
