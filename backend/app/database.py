"""
SQLAlchemy async engine, session factory, ORM table definitions, and FastAPI
dependency for the studyspace-iot backend. All four core tables are declared
here: rooms, sensor_readings, comfort_thresholds, and anomalies.
"""

import os
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from sqlalchemy import (
    TIMESTAMP,
    Float,
    ForeignKey,
    Integer,
    String,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]

async_engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(async_engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class SensorReading(Base):
    __tablename__ = "sensor_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[str] = mapped_column(String, ForeignKey("rooms.id"), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    temperature: Mapped[float] = mapped_column(Float, nullable=False)
    humidity: Mapped[float] = mapped_column(Float, nullable=False)
    motion_count: Mapped[int] = mapped_column(Integer, nullable=False)
    light_raw: Mapped[int] = mapped_column(Integer, nullable=False)
    sound_rms: Mapped[int] = mapped_column(Integer, nullable=False)
    light_lux: Mapped[float] = mapped_column(Float, nullable=True)
    sound_db: Mapped[float] = mapped_column(Float, nullable=True)
    movements_per_min: Mapped[float] = mapped_column(Float, nullable=True)
    comfort_score: Mapped[float] = mapped_column(Float, nullable=True)
    label: Mapped[Optional[str]] = mapped_column(String, nullable=True)


class ComfortThreshold(Base):
    __tablename__ = "comfort_thresholds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    temp_min: Mapped[float] = mapped_column(Float, default=18.0, nullable=False)
    temp_max: Mapped[float] = mapped_column(Float, default=26.0, nullable=False)
    humidity_min: Mapped[float] = mapped_column(Float, default=30.0, nullable=False)
    humidity_max: Mapped[float] = mapped_column(Float, default=60.0, nullable=False)
    sound_max_db: Mapped[float] = mapped_column(Float, default=40.0, nullable=False)
    light_min_lux: Mapped[float] = mapped_column(Float, default=300.0, nullable=False)
    light_max_lux: Mapped[float] = mapped_column(Float, default=500.0, nullable=False)
    motion_max_per_min: Mapped[float] = mapped_column(Float, default=10.0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class Anomaly(Base):
    __tablename__ = "anomalies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[str] = mapped_column(String, ForeignKey("rooms.id"), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    metric: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str] = mapped_column(String, nullable=False)
    reading_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sensor_readings.id"), nullable=False
    )


async def init_db() -> None:
    """Create all tables and seed a default comfort_thresholds row if absent."""
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(ComfortThreshold).limit(1))
        if result.scalar_one_or_none() is None:
            session.add(ComfortThreshold())
            await session.commit()


async def get_db():
    """FastAPI dependency that yields an async database session."""
    async with AsyncSessionLocal() as session:
        yield session
