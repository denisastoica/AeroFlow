"""
Tests for weather, no-fly zones, and charging station endpoints.
"""
import pytest
from tests.conftest import login, bearer


class TestWeather:
    """GET /weather/"""

    def test_get_all_weather(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.get("/weather/", headers=bearer(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "zones" in data
        assert isinstance(data["zones"], list)

    def test_get_weather_at_point(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.get("/weather/at?lat=46.77&lon=23.60", headers=bearer(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "condition" in data
        assert "can_fly" in data


class TestNoFlyZones:
    """CRUD /no-fly-zones/"""

    def test_list_no_fly_zones(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.get("/no-fly-zones/", headers=bearer(token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_create_no_fly_zone_admin(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.post("/no-fly-zones/", json={
            "name": "Test Zone",
            "center_lat": 46.5,
            "center_lon": 23.5,
            "radius_km": 2.0,
            "reason": "test",
            "zone_type": "temporary",
        }, headers=bearer(token))
        assert resp.status_code in (200, 201)
        data = resp.json()
        assert data["name"] == "Test Zone"

    def test_create_nfz_invalid_zone_type(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.post("/no-fly-zones/", json={
            "name": "Bad Zone",
            "center_lat": 46.5,
            "center_lon": 23.5,
            "radius_km": 2.0,
            "zone_type": "invalid_type",
        }, headers=bearer(token))
        assert resp.status_code == 422

    def test_create_nfz_invalid_radius(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.post("/no-fly-zones/", json={
            "name": "Bad Radius",
            "center_lat": 46.5,
            "center_lon": 23.5,
            "radius_km": -5.0,
        }, headers=bearer(token))
        assert resp.status_code == 422

    def test_create_nfz_invalid_coordinates(self, client):
        token = login(client, "admin-auth-test@example.com")
        resp = client.post("/no-fly-zones/", json={
            "name": "Bad Coords",
            "center_lat": 999,
            "center_lon": 23.5,
            "radius_km": 5.0,
        }, headers=bearer(token))
        assert resp.status_code == 422

    def test_check_point(self, client):
        resp = client.get(
            "/no-fly-zones/check?lat=46.77&lon=23.60",
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "is_in_no_fly_zone" in data

    def test_customer_cannot_create_nfz(self, client):
        token = login(client, "customer-auth-test@example.com")
        resp = client.post("/no-fly-zones/", json={
            "name": "Hacker Zone",
            "center_lat": 46.5,
            "center_lon": 23.5,
            "radius_km": 2.0,
        }, headers=bearer(token))
        assert resp.status_code == 403


class TestChargingStations:
    """GET /charging/stations"""

    def test_get_stations(self, client):
        resp = client.get("/charging/stations")
        assert resp.status_code == 200
        data = resp.json()
        assert "stations" in data
        assert "max_autonomy_km" in data
        stations = data["stations"]
        assert isinstance(stations, list)
        assert len(stations) > 0
        s = stations[0]
        assert "lat" in s
        assert "name" in s


class TestRouting:
    """POST /route/"""

    def test_valid_route(self, client):
        resp = client.post("/route/", json={
            "start_lat": 46.77,
            "start_lon": 23.59,
            "end_lat": 46.80,
            "end_lon": 23.65,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "path" in data
        assert "distance_km" in data
        assert len(data["path"]) >= 2

    def test_invalid_coordinates_rejected(self, client):
        resp = client.post("/route/", json={
            "start_lat": 999,
            "start_lon": 23.59,
            "end_lat": 46.80,
            "end_lon": 23.65,
        })
        assert resp.status_code == 422
