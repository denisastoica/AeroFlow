"""
Tests for authentication endpoints: register, login, token validation, profile.
"""
import pytest
from tests.conftest import login, bearer


class TestRegister:
    """POST /auth/register"""

    def test_register_success(self, client):
        resp = client.post("/auth/register", json={
            "email": "newuser@test.com",
            "password": "StrongP1ss",
            "name": "New User",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert "access_token" in data
        assert data["user"]["email"] == "newuser@test.com"
        assert data["user"]["role"] == "customer"

    def test_register_duplicate_email(self, client):
        payload = {
            "email": "dup@test.com",
            "password": "StrongP1ss",
            "name": "First",
        }
        client.post("/auth/register", json=payload)
        resp = client.post("/auth/register", json=payload)
        assert resp.status_code == 400
        assert "already registered" in resp.json()["detail"].lower()

    def test_register_weak_password(self, client):
        resp = client.post("/auth/register", json={
            "email": "weak@test.com",
            "password": "short",
            "name": "Weak",
        })
        assert resp.status_code == 422

    def test_register_missing_uppercase(self, client):
        resp = client.post("/auth/register", json={
            "email": "noup@test.com",
            "password": "alllowercase1",
            "name": "NoUp",
        })
        assert resp.status_code == 422

    def test_register_non_customer_role_rejected(self, client):
        resp = client.post("/auth/register", json={
            "email": "hacker@test.com",
            "password": "StrongP1ss",
            "name": "Hacker",
            "role": "admin",
        })
        assert resp.status_code == 400
        assert "customer" in resp.json()["detail"].lower()

    def test_register_invalid_email(self, client):
        resp = client.post("/auth/register", json={
            "email": "not-an-email",
            "password": "StrongP1ss",
            "name": "Bad Email",
        })
        assert resp.status_code == 422

    def test_register_blank_name(self, client):
        resp = client.post("/auth/register", json={
            "email": "blank@test.com",
            "password": "StrongP1ss",
            "name": "   ",
        })
        assert resp.status_code == 422


class TestLogin:
    """POST /auth/login"""

    def test_login_success(self, client):
        resp = client.post("/auth/login", json={
            "email": "admin-auth-test@example.com",
            "password": "Pass123!",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["user"]["role"] == "admin"

    def test_login_wrong_password(self, client):
        resp = client.post("/auth/login", json={
            "email": "admin-auth-test@example.com",
            "password": "WrongPassword1",
        })
        assert resp.status_code == 401

    def test_login_nonexistent_user(self, client):
        resp = client.post("/auth/login", json={
            "email": "ghost@example.com",
            "password": "Pass123!",
        })
        assert resp.status_code == 401

    def test_login_response_has_user_fields(self, client):
        resp = client.post("/auth/login", json={
            "email": "customer-auth-test@example.com",
            "password": "Pass123!",
        })
        user = resp.json()["user"]
        assert "id" in user
        assert user["email"] == "customer-auth-test@example.com"
        assert user["name"] == "Customer Test"
        assert "hashed_password" not in user


class TestProfile:
    """GET /auth/me"""

    def test_get_profile_authenticated(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.get("/auth/me", headers=bearer(token))
        assert resp.status_code == 200
        assert resp.json()["email"] == "admin-auth-test@example.com"

    def test_get_profile_no_token(self, client):
        resp = client.get("/auth/me")
        assert resp.status_code == 401

    def test_get_profile_invalid_token(self, client):
        resp = client.get("/auth/me", headers=bearer("invalid.jwt.token"))
        assert resp.status_code == 401


class TestLogout:
    """POST /auth/logout"""

    def test_logout_authenticated(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.post("/auth/logout", headers=bearer(token))
        assert resp.status_code == 200
