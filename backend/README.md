# StudySpace IoT — Backend

A FastAPI backend that ingests environmental sensor data from ESP32 microcontrollers, transforms raw sensor values into meaningful units, computes a room comfort score, and serves everything to the React frontend via a REST API.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Running with Docker](#running-with-docker)
- [Running Locally Without Docker](#running-locally-without-docker)
- [API Reference](#api-reference)
- [Data Transformation Logic](#data-transformation-logic)
- [Comfort Score](#comfort-score)
- [Database Schema](#database-schema)
- [Adding a New Room](#adding-a-new-room)
- [ESP32 Integration](#esp32-integration)

---

## Overview

The backend serves as the central hub of the StudySpace IoT system. It receives sensor payloads from one or more ESP32 devices every 5 seconds, validates and transforms the raw data, computes a comfort score for each room, and stores everything in PostgreSQL. The React dashboard polls the backend every 3 seconds to display live readings.

The system monitors four environmental metrics per room:

| Sensor | Metric | Raw Unit | Stored Unit |
|---|---|---|---|
| DHT22 | Temperature | °C | °C |
| DHT22 | Humidity | % RH | % RH |
| LDR | Light intensity | ADC count (0–4095) | Lux |
| INMP441 | Sound level | RMS integer | dB SPL |
| HC-SR501 | Motion | Count per 5s window | Movements per minute |

---

## Tech Stack

| Component | Technology |
|---|---|
| Framework | FastAPI 0.111 |
| Runtime | Python 3.11 |
| Database | PostgreSQL 15 |
| ORM | SQLAlchemy 2.0 (async) |
| DB Driver | asyncpg |
| Validation | Pydantic v2 |
| Data Analysis | Pandas, NumPy |
| ML | scikit-learn, Prophet |
| Server | Uvicorn |
| Container | Docker |

---

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py            # FastAPI app, startup, CORS, routers
│   ├── database.py        # SQLAlchemy models, engine, session, init_db()
│   ├── models.py          # Pydantic request/response schemas
│   ├── transforms.py      # Sensor data conversion and comfort score logic
│   └── routes/
│       ├── __init__.py
│       ├── rooms.py        # CRUD for rooms
│       ├── readings.py     # ESP32 ingest + reading queries
│       ├── thresholds.py   # Comfort threshold management
│       └── anomalies.py    # Anomaly log queries
├── requirements.txt
├── Dockerfile
└── .env.example
```

---

## Environment Variables

Copy `.env.example` to `.env` in the **root of the monorepo** before running anything:

```bash
cp .env.example .env
```

Then fill in your values:

| Variable | Description | Example |
|---|---|---|
| `POSTGRES_USER` | PostgreSQL username | `iot_user` |
| `POSTGRES_PASSWORD` | PostgreSQL password | `yourpassword` |
| `POSTGRES_DB` | Database name | `studyspace_iot` |
| `DATABASE_URL` | Full async connection string | `postgresql+asyncpg://iot_user:yourpassword@db:5432/studyspace_iot` |

> **Note:** When running with Docker Compose, the database host in `DATABASE_URL` must be `db` — the service name defined in `docker-compose.yml`. Docker's internal DNS resolves this automatically. When running locally without Docker, change it to `localhost`.

---

## Running with Docker

This is the recommended way to run the full stack. From the **root of the monorepo**:

```bash
# 1. Copy and fill in environment variables
cp .env.example .env

# 2. Start all services (db, backend, frontend)
docker compose up --build
```

On first boot the backend will:
1. Wait for PostgreSQL to pass its healthcheck
2. Create all database tables automatically
3. Seed the default comfort thresholds
4. Print the local IP address and ESP32-ready endpoint URL to the terminal

Look for this output in the logs:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 StudySpace IoT API is running
 Local IP:   192.168.x.x
 ESP32 URL:  http://192.168.x.x:8000/api/ingest
 Docs:       http://192.168.x.x:8000/docs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Copy the `ESP32 URL` value into `firmware/main/config.h` before flashing.

To stop all services:

```bash
docker compose down
```

To stop and delete the database volume (full reset):

```bash
docker compose down -v
```

---

## Running Locally Without Docker

Use this during development if you want faster iteration without rebuilding Docker images.

**Prerequisites:** Python 3.11, a running PostgreSQL instance.

```bash
# From the backend/ directory

# 1. Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create a .env file in the backend directory
cp .env.example .env
# Edit .env — change the db host from 'db' to 'localhost'

# 4. Start the server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`.
Interactive docs will be at `http://localhost:8000/docs`.

---

## API Reference

### Health Check

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Returns `{"status": "ok", "service": "studyspace-iot"}` |

---

### Rooms

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/rooms` | List all registered rooms |
| `POST` | `/api/rooms` | Register a new room |
| `GET` | `/api/rooms/{room_id}` | Get a single room |
| `DELETE` | `/api/rooms/{room_id}` | Delete a room |

**Register a room — request body:**
```json
{
  "name": "Library Floor 2"
}
```

**Register a room — response:**
```json
{
  "id": "library_floor_2",
  "name": "Library Floor 2",
  "created_at": "2026-04-21T10:00:00Z"
}
```

The `id` slug is auto-generated from the name. You do not provide it manually.

**Error responses:**
- `409 Conflict` — a room with the same slug already exists
- `404 Not Found` — room does not exist (GET / DELETE)

---

### Readings

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/ingest` | Receive sensor payload from ESP32 |
| `GET` | `/api/rooms/{room_id}/readings` | Paginated historical readings |
| `GET` | `/api/rooms/{room_id}/latest` | Most recent reading |
| `GET` | `/api/rooms/{room_id}/summary` | Avg / min / max over last 24 hours |

**Ingest payload (sent by ESP32):**
```json
{
  "room_id": "library_floor_2",
  "timestamp": "2026-04-21T10:00:00Z",
  "temperature": 24.5,
  "humidity": 62.1,
  "motion_count": 3,
  "light_raw": 2847,
  "sound_rms": 14230
}
```

Validation rules applied at ingest time:
- `temperature` must be between −40 and 80 °C
- `humidity` must be between 0 and 100 %
- `room_id` must match a registered room — unregistered devices receive `404`

**Ingest response (stored values after transformation):**
```json
{
  "id": 1,
  "room_id": "library_floor_2",
  "timestamp": "2026-04-21T10:00:00Z",
  "temperature": 24.5,
  "humidity": 62.1,
  "motion_count": 3,
  "light_raw": 2847,
  "sound_rms": 14230,
  "light_lux": 312.4,
  "sound_db": 38.2,
  "movements_per_min": 36.0,
  "comfort_score": 74.5
}
```

**Query params for `/readings`:**
- `limit` — number of records to return (default: `100`, max: `1000`)
- `offset` — pagination offset (default: `0`)

**Summary response:**
```json
{
  "temperature":        { "avg": 23.4, "min": 21.0, "max": 26.1, "unit": "°C" },
  "humidity":           { "avg": 55.2, "min": 48.0, "max": 63.0, "unit": "%" },
  "sound_db":           { "avg": 34.1, "min": 28.0, "max": 51.0, "unit": "dB" },
  "light_lux":          { "avg": 312.0, "min": 200.0, "max": 450.0, "unit": "lux" },
  "movements_per_min":  { "avg": 2.4,   "min": 0.0,   "max": 12.0, "unit": "mov/min" },
  "comfort_score":      { "avg": 78.3,  "min": 61.0,  "max": 91.0, "unit": "/100" }
}
```

If no readings exist in the last 24 hours all numeric values will be `null`.

---

### Thresholds

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/thresholds` | Get current comfort thresholds |
| `PUT` | `/api/thresholds` | Update thresholds (partial update supported) |

**Default threshold values:**

| Field | Default | Unit |
|---|---|---|
| `temp_min` | 18.0 | °C |
| `temp_max` | 26.0 | °C |
| `humidity_min` | 30.0 | % RH |
| `humidity_max` | 60.0 | % RH |
| `sound_max_db` | 40.0 | dB |
| `light_min_lux` | 300.0 | lux |
| `light_max_lux` | 500.0 | lux |
| `motion_max_per_min` | 10.0 | mov/min |

Partial update example — only send what you want to change:
```json
{
  "sound_max_db": 35.0,
  "light_min_lux": 250.0
}
```

Threshold changes take effect on the next ingest call — no restart required.

---

### Anomalies

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/anomalies` | All anomalies across rooms |
| `GET` | `/api/rooms/{room_id}/anomalies` | Anomalies for one room |

**Query params for `/api/anomalies`:**
- `room_id` — filter by room (optional)
- `from_date` — ISO 8601 datetime lower bound (optional)
- `to_date` — ISO 8601 datetime upper bound (optional)
- `limit` — max results (default: `100`)

**Anomaly response object:**
```json
{
  "id": 42,
  "room_id": "library_floor_2",
  "timestamp": "2026-04-21T10:00:00Z",
  "metric": "sound_db",
  "value": 67.3,
  "reason": "3 standard deviations above mean",
  "reading_id": 1891
}
```

---

## Data Transformation Logic

All raw sensor values are transformed in `app/transforms.py` before being stored. No transformation logic lives in the routes. This keeps the transform functions independently unit-testable.

### LDR → Lux

The LDR is wired in a voltage divider with a 10 kΩ resistor powered by 3.3 V. The ADC count is converted to resistance, then to lux using the GL5528 LDR power law:

```
voltage          = (adc_value / 4095) × 3.3
ldr_resistance   = (10000 × voltage) / (3.3 − voltage)
lux              = 500 / (ldr_resistance_kΩ) ^ 0.7
```

Output is clamped to a minimum of 0.0. A saturated ADC (value = 4095) returns 0.0 rather than raising a division-by-zero error.

### INMP441 RMS → dB SPL

The INMP441 outputs 24-bit signed integers. Its nominal sensitivity is −26 dBFS at 94 dB SPL, giving a reference RMS of ~420,426. The conversion anchors to this to produce real-world dB SPL:

```
dB SPL = 20 × log10(rms_value / 420426) + 94
```

An RMS value of 0 or below returns 0.0 to avoid math domain errors.

### HC-SR501 motion count → movements per minute

The ESP32 counts rising-edge interrupts from the PIR sensor in a 5-second window and resets the counter after each payload. Since there are 12 five-second windows per minute:

```
movements_per_min = motion_count × 12
```

If the firmware window duration ever changes, update `_WINDOWS_PER_MINUTE` in `transforms.py` to match.

### DHT22

Temperature (°C) and humidity (% RH) are already in final units. No conversion needed.

---

## Comfort Score

The comfort score is a single 0–100 float computed in `transforms.compute_comfort_score()`. Each of the five metrics contributes equally at 20 points maximum.

| Metric | Full score condition | Penalty |
|---|---|---|
| Temperature | Within `temp_min`–`temp_max` | Proportional, zero at ±10 °C outside range |
| Humidity | Within `humidity_min`–`humidity_max` | Proportional, zero at ±30 % outside range |
| Sound | At or below `sound_max_db` | −2 pts per dB over threshold, zero at +10 dB |
| Light | Within `light_min_lux`–`light_max_lux` | Proportional, zero at ±500 lux outside range |
| Motion | At or below `motion_max_per_min` | −2 pts per mov/min over threshold, zero at +10 |

Thresholds are read from the `comfort_thresholds` table at ingest time, so changes made through the Settings page take effect on the next reading without restarting the server.

**Score interpretation:**

| Score | Label |
|---|---|
| 75–100 | Good for studying |
| 50–74 | Moderate |
| 0–49 | Poor conditions |

---

## Database Schema

Four tables. All managed by SQLAlchemy — no manual migration needed on first boot. `init_db()` runs `CREATE TABLE IF NOT EXISTS` for each table and seeds one default row into `comfort_thresholds` if it is empty.

```
rooms
  id           VARCHAR  PK  (slug, e.g. library_floor_2)
  name         VARCHAR
  created_at   TIMESTAMP WITH TIME ZONE

sensor_readings
  id                 SERIAL   PK
  room_id            VARCHAR  FK → rooms.id
  timestamp          TIMESTAMP WITH TIME ZONE
  temperature        FLOAT
  humidity           FLOAT
  motion_count       INTEGER
  light_raw          INTEGER
  sound_rms          INTEGER
  light_lux          FLOAT
  sound_db           FLOAT
  movements_per_min  FLOAT
  comfort_score      FLOAT

comfort_thresholds
  id                   SERIAL  PK
  temp_min             FLOAT   DEFAULT 18.0
  temp_max             FLOAT   DEFAULT 26.0
  humidity_min         FLOAT   DEFAULT 30.0
  humidity_max         FLOAT   DEFAULT 60.0
  sound_max_db         FLOAT   DEFAULT 40.0
  light_min_lux        FLOAT   DEFAULT 300.0
  light_max_lux        FLOAT   DEFAULT 500.0
  motion_max_per_min   FLOAT   DEFAULT 10.0
  updated_at           TIMESTAMP WITH TIME ZONE

anomalies
  id          SERIAL   PK
  room_id     VARCHAR  FK → rooms.id
  timestamp   TIMESTAMP WITH TIME ZONE
  metric      VARCHAR
  value       FLOAT
  reason      VARCHAR
  reading_id  INTEGER  FK → sensor_readings.id
```

---

## Adding a New Room

**Always register the room in the dashboard before flashing the ESP32.** The backend validates `room_id` on every ingest request and returns `404` for any unregistered device.

1. Open the Settings page at `http://localhost:3000/settings`
2. Click **Add Room** and type the room's display name
3. The slug is auto-generated — copy it exactly
4. Open `firmware/main/config.h` and set:
```cpp
#define ROOM_ID "your_room_slug"
```
5. Flash the ESP32 via Arduino IDE
6. The ESP32 will start posting to `/api/ingest` — confirm it is receiving `201` responses via the Serial monitor

Alternatively, register via the API directly:
```bash
curl -X POST http://localhost:8000/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"name": "Library Floor 2"}'
```

---

## ESP32 Integration

The ESP32 sends a `POST` request to `/api/ingest` every 5 seconds with a JSON body. It expects a `201 Created` response on success. Any other status code should be logged to Serial for debugging.

The backend URL to set in `firmware/main/config.h` is printed to the terminal on every startup — copy it from the Docker logs rather than constructing it manually:

```
ESP32 URL:  http://192.168.x.x:8000/api/ingest
```

**Important:** The ESP32 must be on the same local network as the machine running Docker. The URL uses the host machine's LAN IP, not `localhost` — `localhost` is unreachable from the ESP32.

See `firmware/main/config.h` and `firmware/README.md` for full wiring diagrams, pin assignments, and flash instructions.
