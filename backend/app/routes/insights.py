"""
Insights route: ML-powered prediction endpoint.

The prediction model is trained in analysis/studyspace_analysis.ipynb and
saved to backend/models/comfort_classifier.pkl using joblib.  This endpoint
loads that artifact at request time and returns the predicted comfort label
and confidence for the room's latest reading.

If the model file does not yet exist the endpoint returns status='not_trained'
so the frontend can show a friendly prompt to run the notebook first.
"""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Room, SensorReading, get_db

router = APIRouter(prefix="/api", tags=["insights"])

DB = Annotated[AsyncSession, Depends(get_db)]

_MODEL_PATH = Path(__file__).parent.parent.parent / "models" / "comfort_classifier.pkl"
_SCALER_PATH = Path(__file__).parent.parent.parent / "models" / "feature_scaler.pkl"

FEATURES = ["temperature", "humidity", "sound_db", "light_lux", "movements_per_min"]


@router.get("/rooms/{room_id}/predict")
async def predict_comfort(room_id: str, db: DB):
    """Return the ML-predicted comfort label for the room's latest reading.

    Response shape
    --------------
    When model is trained:
        {
            "status": "ok",
            "predicted_label": "comfortable",
            "confidence": 0.87,
            "rule_label": "comfortable",          # from classify_reading()
            "labels_match": true,                 # rule == ML prediction
            "feature_importances": {...},          # RandomForest importances
            "features": { temperature, humidity, sound_db, light_lux, movements_per_min }
        }

    When model is not yet trained:
        { "status": "not_trained", "message": "..." }
    """
    room_result = await db.execute(select(Room).where(Room.id == room_id))
    if room_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    if not _MODEL_PATH.exists():
        return {
            "status": "not_trained",
            "message": "Open analysis/studyspace_analysis.ipynb in VS Code and run all cells to train the model.",
        }

    result = await db.execute(
        select(SensorReading)
        .where(SensorReading.room_id == room_id)
        .where(SensorReading.sound_db.isnot(None))
        .order_by(SensorReading.timestamp.desc())
        .limit(1)
    )
    reading = result.scalar_one_or_none()
    if reading is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No readings yet")

    import joblib
    import numpy as np

    model = joblib.load(_MODEL_PATH)
    feature_values = [
        reading.temperature,
        reading.humidity,
        reading.sound_db,
        reading.light_lux,
        reading.movements_per_min,
    ]

    X = np.array([feature_values])
    if _SCALER_PATH.exists():
        scaler = joblib.load(_SCALER_PATH)
        X = scaler.transform(X)

    predicted_label = model.predict(X)[0]
    confidence      = float(model.predict_proba(X)[0].max())

    importances = {}
    if hasattr(model, "feature_importances_"):
        importances = dict(zip(FEATURES, [round(float(v), 4) for v in model.feature_importances_]))

    return {
        "status": "ok",
        "predicted_label": predicted_label,
        "confidence": round(confidence, 3),
        "rule_label": reading.label,
        "labels_match": predicted_label == reading.label,
        "feature_importances": importances,
        "features": dict(zip(FEATURES, feature_values)),
    }
