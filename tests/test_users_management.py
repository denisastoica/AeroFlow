"""Tests for admin user management safeguards and role constraints."""

from tests.conftest import login, bearer


def test_admin_can_list_users(client):
    token = login(client, "admin-auth-test@example.com")
    resp = client.get("/users/", headers=bearer(token))
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert any(u["email"] == "admin-auth-test@example.com" for u in data)


def test_create_user_with_invalid_driver_role_rejected(client):
    token = login(client, "admin-auth-test@example.com")
    resp = client.post(
        "/users/",
        headers=bearer(token),
        json={
            "email": "driver-like@test.com",
            "password": "StrongP1ss",
            "name": "Driver Like",
            "role": "driver",
        },
    )
    assert resp.status_code == 422


def test_cannot_demote_last_active_admin(client):
    token = login(client, "admin-auth-test@example.com")


    resp = client.patch(
        "/users/1",
        headers=bearer(token),
        json={"role": "dispatcher"},
    )
    assert resp.status_code == 400
    assert "own admin role" in resp.json()["detail"].lower()


def test_cannot_deactivate_last_active_admin(client):
    token = login(client, "admin-auth-test@example.com")

    resp = client.patch(
        "/users/1",
        headers=bearer(token),
        json={"is_active": False},
    )
    assert resp.status_code == 400
    assert "active admin" in resp.json()["detail"].lower()


def test_cannot_remove_own_admin_role(client):
    token = login(client, "admin-auth-test@example.com")

    resp = client.patch(
        "/users/1",
        headers=bearer(token),
        json={"role": "customer"},
    )
    assert resp.status_code == 400
    assert "own admin role" in resp.json()["detail"].lower()
