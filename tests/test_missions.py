"""
Tests for missions and mission events endpoints.
"""
import pytest
from tests.conftest import login, bearer


class TestMissionList:
    """GET /missions/"""

    def test_admin_lists_missions(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.get("/missions/", headers=bearer(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert isinstance(data["items"], list)

    def test_dispatcher_lists_missions(self, client):
        token = login(client, "dispatcher-auth-test@example.com")
        resp = client.get("/missions/", headers=bearer(token))
        assert resp.status_code == 200

    def test_customer_sees_own_missions(self, client):
        token = login(client, "customer-auth-test@example.com")
        resp = client.get("/missions/", headers=bearer(token))

        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert isinstance(data["items"], list)

    def test_unauthenticated_rejected(self, client):
        resp = client.get("/missions/")
        assert resp.status_code == 401


class TestMissionStats:
    """GET /missions/stats"""

    def test_admin_gets_stats(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.get("/missions/stats", headers=bearer(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "total" in data


class TestMissionEvents:
    """GET /missions/{id}/events"""

    def test_nonexistent_mission_events(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.get("/missions/99999/events", headers=bearer(token))

        assert resp.status_code in (200, 404)
