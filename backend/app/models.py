"""
Pydantic v2 schemas for request validation and response serialization across
all four studyspace-iot domain objects: rooms, sensor readings, comfort
thresholds, and anomalies.
"""

import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


# ---------------------------------------------------------------------------
# Room
# ---------------------------------------------------------------------------


class RoomCreate(BaseModel):
    name: str

    @model_validator(mode="after")
    def generate_id(self) -> "RoomCreate":
        slug = self.name.strip().lower()
        slug = re.sub(r"\s+", "_", slug)
        slug = re.sub(r"[^a-z0-9_]", "", slug)
        self.id = slug
        return self

    # id is populated by the validator above; declare it so it exists on the model
    id: str = ""


class RoomResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Sensor payload (inbound from ESP32)
# ---------------------------------------------------------------------------


class SensorPayload(BaseModel):
    room_id: str
    timestamp: datetime
    temperature: float
    humidity: float
    motion_count: int
    light_raw: int
    sound_rms: int

    @field_validator("temperature")
    @classmethod
    def validate_temperature(cls, v: float) -> float:
        if not (-40.0 <= v <= 80.0):
            raise ValueError(f"temperature {v}°C is outside the valid range −40 to 80°C")
        return v

    @field_validator("humidity")
    @classmethod
    def validate_humidity(cls, v: float) -> float:
        if not (0.0 <= v <= 100.0):
            raise ValueError(f"humidity {v}% is outside the valid range 0–100%")
        return v


# ---------------------------------------------------------------------------
# Reading response (outbound, includes transformed fields)
# ---------------------------------------------------------------------------


class ReadingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    room_id: str
    timestamp: datetime
    temperature: float
    humidity: float
    motion_count: int
    light_raw: int
    sound_rms: int
    light_lux: Optional[float]
    sound_db: Optional[float]
    movements_per_min: Optional[float]
    comfort_score: Optional[float]
    label: Optional[str]


# ---------------------------------------------------------------------------
# Comfort thresholds
# ---------------------------------------------------------------------------


class ThresholdUpdate(BaseModel):
    temp_min: Optional[float] = None
    temp_max: Optional[float] = None
    humidity_min: Optional[float] = None
    humidity_max: Optional[float] = None
    sound_max_db: Optional[float] = None
    light_min_lux: Optional[float] = None
    light_max_lux: Optional[float] = None
    motion_max_per_min: Optional[float] = None


class ThresholdResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    temp_min: float
    temp_max: float
    humidity_min: float
    humidity_max: float
    sound_max_db: float
    light_min_lux: float
    light_max_lux: float
    motion_max_per_min: float
    updated_at: datetime


# ---------------------------------------------------------------------------
# Anomaly
# ---------------------------------------------------------------------------


class AnomalyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    room_id: str
    timestamp: datetime
    metric: str
    value: float
    reason: str
    reading_id: int
