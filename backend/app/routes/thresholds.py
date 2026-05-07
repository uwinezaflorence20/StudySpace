"""
Route handlers for the comfort thresholds resource.

Manages the single `comfort_thresholds` configuration row that controls how
the comfort score is computed and what values are flagged as anomalies.
"""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import ComfortThreshold, get_db
from app.models import ThresholdResponse, ThresholdUpdate

router = APIRouter(prefix="/api/thresholds", tags=["thresholds"])

DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=ThresholdResponse)
async def get_thresholds(db: DB):
    result = await db.execute(select(ComfortThreshold).limit(1))
    return result.scalar_one()


@router.put("", response_model=ThresholdResponse)
async def update_thresholds(body: ThresholdUpdate, db: DB):
    result = await db.execute(select(ComfortThreshold).limit(1))
    thresholds = result.scalar_one()

    updates = body.model_dump(exclude_none=True)
    for field, value in updates.items():
        setattr(thresholds, field, value)
    thresholds.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(thresholds)
    return thresholds
