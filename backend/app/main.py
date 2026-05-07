"""
FastAPI application entry point for the studyspace-iot backend.

Wires together the database initialisation, CORS middleware, and all four
route modules (rooms, readings, thresholds, anomalies).
"""

import socket
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routes import anomalies, insights, readings, rooms, thresholds


def _local_ip() -> str:
    """Return the machine's primary LAN IP without making an external request."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    ip = _local_ip()
    bar = "━" * 40
    print(f"\n{bar}")
    print(" StudySpace IoT API is running")
    print(f" Local IP:   {ip}")
    print(f" ESP32 URL:  http://{ip}:8000/api/ingest")
    print(f" Docs:       http://{ip}:8000/docs")
    print(f"{bar}\n")

    yield


app = FastAPI(
    title="StudySpace IoT API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rooms.router)
app.include_router(readings.router)
app.include_router(thresholds.router)
app.include_router(anomalies.router)
app.include_router(insights.router)


@app.get("/", tags=["health"])
async def health_check():
    return {"status": "ok", "service": "studyspace-iot"}
