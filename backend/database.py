import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from pathlib import Path


_DB_PATH = (Path(__file__).resolve().parent / "drone.db").as_posix()

if os.getenv("TESTING") == "1":

    SQLALCHEMY_DATABASE_URL = "sqlite://"
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
else:

    SQLALCHEMY_DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql://postgres:1234@localhost:5433/drone_platform"
    )
    

    if SQLALCHEMY_DATABASE_URL.startswith("postgresql"):
        engine = create_engine(SQLALCHEMY_DATABASE_URL)
    else:
        engine = create_engine(
            SQLALCHEMY_DATABASE_URL,
            connect_args={"check_same_thread": False},
        )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Database session dependency for FastAPI endpoints"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
