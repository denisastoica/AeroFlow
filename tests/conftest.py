import os

os.environ["TESTING"] = "1"

import bcrypt
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import SessionLocal, Base, engine
from backend.models import user, drone, delivery, mission, no_fly_zone, alert, audit_log, mission_event
from backend.models.user import User
from backend.models.drone import Drone
from backend.models.delivery import Delivery
from backend.models.charging_station import ChargingStation


def _hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


@pytest.fixture(scope="session", autouse=True)
def _seed_test_database():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            return

        admin = User(
            email="admin-auth-test@example.com",
            hashed_password=_hash("Pass123!"),
            name="Admin Test",
            role="admin",
            is_active=True,
        )
        dispatcher = User(
            email="dispatcher-auth-test@example.com",
            hashed_password=_hash("Pass123!"),
            name="Dispatcher Test",
            role="dispatcher",
            is_active=True,
        )
        customer = User(
            email="customer-auth-test@example.com",
            hashed_password=_hash("Pass123!"),
            name="Customer Test",
            role="customer",
            is_active=True,
        )
        db.add_all([admin, dispatcher, customer])
        db.commit()
        db.refresh(customer)

        st1 = ChargingStation(
            name="Test Station 1",
            latitude=46.77,
            longitude=23.60,
            active=True
        )
        db.add(st1)
        db.commit()

        d_assign = Drone(
            name="Drone-Assigned",
            latitude=46.77,
            longitude=23.62,
            battery=100,
            status="idle",
        )
        d_free = Drone(
            name="Drone-Free",
            latitude=46.78,
            longitude=23.63,
            battery=100,
            status="idle",
        )
        db.add_all([d_assign, d_free])
        db.commit()
        db.refresh(d_assign)
        db.refresh(d_free)

        deliv = Delivery(
            customer_id=customer.id,
            pickup_lat=46.76,
            pickup_lon=23.61,
            dest_lat=46.79,
            dest_lon=23.64,
            status="assigned",
            drone_id=d_free.id,
            estimated_distance_km=5.0,
            estimated_duration_h=0.2,
        )
        db.add(deliv)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def login(client: TestClient, email: str, password: str = "Pass123!") -> str:
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
