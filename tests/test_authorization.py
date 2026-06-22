"""Tests for role-based access control."""

from tests.conftest import login, bearer


def test_customer_cannot_access_fleet_status(client):
    tok = login(client, "customer-auth-test@example.com")
    r = client.get("/drones/fleet-status", headers=bearer(tok))
    assert r.status_code == 403


def test_dispatcher_can_access_fleet_status(client):
    tok = login(client, "dispatcher-auth-test@example.com")
    r = client.get("/drones/fleet-status", headers=bearer(tok))
    assert r.status_code == 200


def test_customer_can_list_own_deliveries(client):
    tok = login(client, "customer-auth-test@example.com")
    r = client.get("/deliveries/", headers=bearer(tok))
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert isinstance(data["items"], list)


def test_dispatcher_can_list_all_deliveries(client):
    tok = login(client, "dispatcher-auth-test@example.com")
    r = client.get("/deliveries/", headers=bearer(tok))
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert isinstance(data["items"], list)
