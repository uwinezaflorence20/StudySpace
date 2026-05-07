"""
Route handlers for sensor readings ingestion and retrieval.

Manages the `/api/ingest` endpoint consumed by ESP32 firmware and the
per-room reading history, latest snapshot, and 24-hour summary endpoints.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import numpy as np

from app.database import Anomaly, ComfortThreshold, Room, SensorReading, get_db
from app.models import ReadingResponse, SensorPayload
from app.transforms import apparent_temperature, run_all_transforms

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["readings"])

DB = Annotated[AsyncSession, Depends(get_db)]


def _detect_anomalies(
    reading: SensorReading,
    thresholds: ComfortThreshold,
) -> list[tuple[str, float, str]]:
    """Return (metric, value, reason) tuples for any anomalous metric values.

    Anomaly bounds are deliberately wider than comfort thresholds — they flag
    physically unusual events rather than minor discomfort.  Calibrated to
    Kigali indoor conditions (ASHRAE 55 tropical norms):

        Apparent temp  > temp_max + 5 °C  or  < temp_min − 5 °C
        Humidity       > 78 %  or  < 28 %
        Sound          > sound_max_db + 18 dB   (> 58 dB default)
        Light          < 100 lux  or  > 900 lux
        Motion         > motion_max × 3
    """
    flags: list[tuple[str, float, str]] = []

    at = apparent_temperature(reading.temperature, reading.humidity)
    if at > thresholds.temp_max + 5:
        excess = round(at - thresholds.temp_max, 1)
        flags.append(("apparent_temp", round(at, 2),
                       f"Apparent temperature {at:.1f} °C is {excess} °C above comfort range — possible HVAC failure or direct heat source"))
    elif at < thresholds.temp_min - 5:
        deficit = round(thresholds.temp_min - at, 1)
        flags.append(("apparent_temp", round(at, 2),
                       f"Apparent temperature {at:.1f} °C is {deficit} °C below comfort range — possible ventilation failure or cold infiltration"))

    if reading.humidity is not None and reading.humidity > 78:
        flags.append(("humidity", reading.humidity,
                       f"Humidity {reading.humidity:.1f} % exceeds 78 % — risk of condensation and mould growth"))
    elif reading.humidity is not None and reading.humidity < 28:
        flags.append(("humidity", reading.humidity,
                       f"Humidity {reading.humidity:.1f} % is below 28 % — air is excessively dry"))

    if reading.sound_db is not None and reading.sound_db > thresholds.sound_max_db + 18:
        excess = round(reading.sound_db - thresholds.sound_max_db, 1)
        flags.append(("sound_db", reading.sound_db,
                       f"Sound level {reading.sound_db:.1f} dB is {excess} dB above threshold — acoustic spike event"))

    if reading.light_lux is not None and reading.light_lux < 100:
        flags.append(("light_lux", reading.light_lux,
                       f"Illuminance {reading.light_lux:.0f} lux is critically low — possible lamp failure or blackout"))
    elif reading.light_lux is not None and reading.light_lux > 900:
        flags.append(("light_lux", reading.light_lux,
                       f"Illuminance {reading.light_lux:.0f} lux is excessively bright — direct sunlight or fixture fault"))

    if reading.movements_per_min is not None and reading.movements_per_min > thresholds.motion_max_per_min * 3:
        flags.append(("movements_per_min", reading.movements_per_min,
                       f"Motion rate {reading.movements_per_min:.0f} mov/min is 3× above normal — unusual occupancy event"))

    return flags


@router.post("/ingest", response_model=ReadingResponse, status_code=status.HTTP_201_CREATED)
async def ingest(payload: SensorPayload, db: DB):
    try:
        room_result = await db.execute(select(Room).where(Room.id == payload.room_id))
        if room_result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Room not registered. Register this room in the dashboard before flashing.",
            )

        threshold_result = await db.execute(select(ComfortThreshold).limit(1))
        thresholds = threshold_result.scalar_one()

        transformed = run_all_transforms(payload, thresholds)

        reading = SensorReading(
            room_id=payload.room_id,
            timestamp=payload.timestamp,
            temperature=payload.temperature,
            humidity=payload.humidity,
            motion_count=payload.motion_count,
            light_raw=payload.light_raw,
            sound_rms=payload.sound_rms,
            **transformed,
        )
        db.add(reading)
        await db.commit()
        await db.refresh(reading)

        anomalies = _detect_anomalies(reading, thresholds)
        if anomalies:
            for metric, value, reason in anomalies:
                db.add(Anomaly(
                    room_id=reading.room_id,
                    timestamp=reading.timestamp,
                    metric=metric,
                    value=value,
                    reason=reason,
                    reading_id=reading.id,
                ))
            await db.commit()

        return reading

    except HTTPException:
        raise
    except Exception:
        logger.exception("Unexpected error during ingest for room_id=%s", payload.room_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process sensor reading. Please try again.",
        )


@router.get("/rooms/{room_id}/readings", response_model=list[ReadingResponse])
async def get_readings(
    room_id: str,
    db: DB,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    room_result = await db.execute(select(Room).where(Room.id == room_id))
    if room_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    result = await db.execute(
        select(SensorReading)
        .where(SensorReading.room_id == room_id)
        .order_by(SensorReading.timestamp.desc())
        .limit(limit)
        .offset(offset)
    )
    return result.scalars().all()


@router.get("/rooms/{room_id}/latest", response_model=ReadingResponse)
async def get_latest(room_id: str, db: DB):
    room_result = await db.execute(select(Room).where(Room.id == room_id))
    if room_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    result = await db.execute(
        select(SensorReading)
        .where(SensorReading.room_id == room_id)
        .order_by(SensorReading.timestamp.desc())
        .limit(1)
    )
    reading = result.scalar_one_or_none()
    if reading is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No readings yet for this room",
        )
    return reading


@router.get("/rooms/{room_id}/summary")
async def get_summary(room_id: str, db: DB):
    room_result = await db.execute(select(Room).where(Room.id == room_id))
    if room_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    since = datetime.now(timezone.utc) - timedelta(hours=24)

    metrics = {
        "temperature": ("°C", SensorReading.temperature),
        "humidity": ("%", SensorReading.humidity),
        "sound_db": ("dB", SensorReading.sound_db),
        "light_lux": ("lux", SensorReading.light_lux),
        "movements_per_min": ("mov/min", SensorReading.movements_per_min),
        "comfort_score": ("/100", SensorReading.comfort_score),
    }

    summary = {}
    for name, (unit, col) in metrics.items():
        result = await db.execute(
            select(
                func.avg(col).label("avg"),
                func.min(col).label("min"),
                func.max(col).label("max"),
            ).where(
                SensorReading.room_id == room_id,
                SensorReading.timestamp >= since,
            )
        )
        row = result.one()
        if row.avg is None:
            summary[name] = {"avg": None, "min": None, "max": None, "unit": unit}
        else:
            summary[name] = {
                "avg": round(row.avg, 1),
                "min": round(row.min, 1),
                "max": round(row.max, 1),
                "unit": unit,
            }

    return summary


@router.get("/rooms/{room_id}/correlation")
async def get_correlation(
    room_id: str,
    db: DB,
    limit: Annotated[int, Query(ge=10, le=5000)] = 500,
):
    """Pearson correlation matrix between the five sensor metrics.

    Returns the 5×5 matrix as a nested list alongside the ordered metric names
    so the frontend can render a labelled heatmap.  Uses the most recent
    `limit` readings that have all five derived fields populated.

    Interpretation guide (returned as `guide`):
        |r| > 0.7  — strong relationship
        |r| > 0.4  — moderate relationship
        |r| ≤ 0.4  — weak or no linear relationship
    """
    room_result = await db.execute(select(Room).where(Room.id == room_id))
    if room_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    result = await db.execute(
        select(
            SensorReading.temperature,
            SensorReading.humidity,
            SensorReading.sound_db,
            SensorReading.light_lux,
            SensorReading.movements_per_min,
        )
        .where(SensorReading.room_id == room_id)
        .where(SensorReading.sound_db.isnot(None))
        .where(SensorReading.light_lux.isnot(None))
        .where(SensorReading.movements_per_min.isnot(None))
        .order_by(SensorReading.timestamp.desc())
        .limit(limit)
    )
    rows = result.all()

    if len(rows) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not enough readings for correlation analysis (need at least 10)",
        )

    metrics = ["temperature", "humidity", "sound_db", "light_lux", "movements_per_min"]
    data = np.array([[r.temperature, r.humidity, r.sound_db, r.light_lux, r.movements_per_min]
                     for r in rows], dtype=float)
    matrix = np.corrcoef(data.T).tolist()

    return {"metrics": metrics, "matrix": matrix, "n_readings": len(rows)}


@router.get("/rooms/{room_id}/label-distribution")
async def get_label_distribution(room_id: str, db: DB):
    """Count of each classification label for the last 24 hours."""
    room_result = await db.execute(select(Room).where(Room.id == room_id))
    if room_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    since = datetime.now(timezone.utc) - timedelta(hours=24)
    result = await db.execute(
        select(SensorReading.label, func.count(SensorReading.label).label("count"))
        .where(SensorReading.room_id == room_id)
        .where(SensorReading.timestamp >= since)
        .where(SensorReading.label.isnot(None))
        .group_by(SensorReading.label)
        .order_by(func.count(SensorReading.label).desc())
    )
    return [{"label": r.label, "count": r.count} for r in result.all()]
