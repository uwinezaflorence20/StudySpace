# StudySpace IoT — Complete Study Guide

> University of Rwanda · Faculty of Engineering · 2026  
> A full-stack IoT system: ESP32 → FastAPI → PostgreSQL → React dashboard

---

## Table of Contents

1. [What the System Does](#1-what-the-system-does)
2. [System Architecture](#2-system-architecture)
3. [Hardware — Sensors and Wiring](#3-hardware--sensors-and-wiring)
4. [Firmware (ESP32 / Arduino)](#4-firmware-esp32--arduino)
5. [Sensor Math — Unit Conversions](#5-sensor-math--unit-conversions)
6. [Comfort Score Algorithm](#6-comfort-score-algorithm)
7. [Condition Classification](#7-condition-classification)
8. [Anomaly Detection](#8-anomaly-detection)
9. [Backend Deep-Dive (FastAPI)](#9-backend-deep-dive-fastapi)
10. [Database Schema](#10-database-schema)
11. [API Reference](#11-api-reference)
12. [Frontend (React)](#12-frontend-react)
13. [Machine Learning Pipeline](#13-machine-learning-pipeline)
14. [Running the Project](#14-running-the-project)
15. [Data Flow — End-to-End Trace](#15-data-flow--end-to-end-trace)
16. [Standards and Research Referenced](#16-standards-and-research-referenced)
17. [Exam-Style Questions and Answers](#17-exam-style-questions-and-answers)

---

## 1. What the System Does

StudySpace IoT monitors the comfort conditions inside university study rooms using four physical sensors connected to an ESP32 microcontroller. Every 5 seconds the ESP32:

1. Reads temperature, humidity, light level, sound level, and motion count.
2. Posts the raw sensor values to a FastAPI backend over HTTP/WiFi.
3. The backend converts raw values into physical units (lux, dB, °C apparent), computes a comfort score, assigns a condition label, detects anomalies, then stores everything in PostgreSQL.
4. A React dashboard displays the data as live metric cards, time-series charts, anomaly lists, and ML predictions.

**Why it matters for study rooms specifically:**  
Poor environmental conditions — too hot, too humid, too noisy, too dark — directly reduce cognitive performance. This system makes those conditions measurable and actionable.

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ PHYSICAL LAYER (Hardware)                                    │
│                                                              │
│  DHT22  ──┐                                                  │
│  PIR    ──┤                                                  │
│  LDR    ──┼── ESP32 ──(HTTP POST / WiFi)──► FastAPI Backend  │
│  INMP441──┘                                                  │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ BACKEND LAYER  (Python · FastAPI · asyncpg · SQLAlchemy)     │
│                                                              │
│  POST /api/ingest                                            │
│    ├── adc_to_lux()            raw ADC → lux                 │
│    ├── rms_to_db()             RMS int → dB SPL              │
│    ├── compute_movements_per_min()  count → mov/min          │
│    ├── compute_comfort_score() 3-component 0–100 score       │
│    ├── classify_reading()      8-class label                 │
│    └── _detect_anomalies()     IQR-style threshold checks    │
│                                                              │
│  GET endpoints ──► PostgreSQL 15 (async reads)               │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ FRONTEND LAYER  (React 18 · Recharts · React Router 6)       │
│                                                              │
│  /              → RoomList   (card grid)                     │
│  /rooms/:id     → RoomDetail (live metrics + charts)         │
│  /rooms/:id/metrics/:m → MetricDetail (time-series)          │
│  /anomalies     → Anomalies  (flagged events)                │
│  /insights      → Insights   (correlation heatmap + ML)      │
│  /settings      → Settings   (threshold editor)              │
└──────────────────────────────────────────────────────────────┘
```

**Key technology choices:**

| Component | Technology | Why |
|-----------|-----------|-----|
| Microcontroller | ESP32 | Built-in WiFi, 12-bit ADC, I2S bus for MEMS mic, 3.3 V GPIO |
| Backend framework | FastAPI | Async Python, auto-generates OpenAPI docs, fast JSON serialization |
| ORM | SQLAlchemy (async) | Type-safe models, async sessions via asyncpg |
| Database | PostgreSQL 15 | ACID, TIMESTAMP WITH TIME ZONE, efficient aggregation |
| Frontend | React 18 | Component model suits dashboard; hooks simplify polling |
| Charts | Recharts | SVG-based, composable, works with React |
| Containerisation | Docker Compose | One command brings up DB + backend + frontend |

---

## 3. Hardware — Sensors and Wiring

### Why each sensor was chosen

| Sensor | Measures | Key specification | Why this choice |
|--------|----------|------------------|-----------------|
| **DHT22** | Temperature + Humidity | ±0.5 °C / ±2–5 % RH, single-wire | Temperature and humidity must be read **together** because the body experiences them as a combined "apparent temperature" — you cannot score thermal comfort with temperature alone |
| **HC-SR501 (PIR)** | Motion events | Digital output, interrupt-driven | Gives a crowd-density proxy without cameras or identifying data. Passive infrared detects moving heat sources |
| **GL5528 (LDR)** | Light / Illuminance | Photoresistor, voltage divider | Low cost; the resistance-to-lux power-law is well-characterized for 10–1 000 lux — exactly the indoor range |
| **INMP441 (MEMS Mic)** | Sound pressure | 24-bit I2S, −26 dBFS at 94 dB SPL | I2S digital output eliminates analog amplifier noise. 24-bit depth gives high dynamic range. No analog microphone noise floor problem |

### Wiring table

```
ESP32 Pin   Sensor        Signal
─────────────────────────────────────────────────────────────
GPIO 4      DHT22         Data (10 kΩ pull-up to 3.3 V)
GPIO 27     HC-SR501      Digital output (interrupt, RISING)
GPIO 34     LDR divider   ADC1 channel 6 — input-only pin
GPIO 14     INMP441       BCLK  (I2S serial bit clock)
GPIO 15     INMP441       LRCL  (I2S word select — L/R → GND)
GPIO 32     INMP441       DOUT  (I2S data out from mic)
```

> **Important:** GPIO 34 on the ESP32 is input-only — never drive it HIGH. It connects to the midpoint of the LDR voltage divider.

### LDR Voltage Divider Circuit

```
3.3V ── [GL5528 LDR] ──┬── [10 kΩ fixed] ── GND
                       └── GPIO 34 (ADC)
```

When the room gets **brighter**, LDR resistance **drops**, the midpoint voltage **rises**, and the ADC count **increases**.

---

## 4. Firmware (ESP32 / Arduino)

The firmware lives in `firmware/main/` and consists of three files:

| File | Purpose |
|------|---------|
| `config.h` | WiFi credentials, backend URL, GPIO pins, timing constants |
| `sensors.h` | DHT22, PIR, LDR, INMP441 driver functions |
| `main.ino` | WiFi connection, NTP time sync, 5-second send loop |

### Send loop (pseudo-code)

```cpp
every 5000ms:
    temperature, humidity = DHT22.read()
    motion_count = PIR_interrupt_counter; reset counter
    light_raw    = analogRead(GPIO_34)           // 0–4095
    sound_rms    = I2S_compute_RMS(1024_samples) // integer
    
    POST http://BACKEND_URL/api/ingest {
      room_id, timestamp, temperature, humidity,
      motion_count, light_raw, sound_rms
    }
```

The firmware sends **raw** values only. All unit conversions happen on the backend, which makes the firmware simpler and keeps the calibration math in one place.

### Important firmware constants

```c
#define SEND_INTERVAL      5000    // ms — must match _WINDOWS_PER_MINUTE in transforms.py
#define MOTION_WINDOW_MS   5000    // ms — PIR counting window
```

If you change `SEND_INTERVAL`, you must also update `_WINDOWS_PER_MINUTE` in `backend/app/transforms.py` to `60 / (SEND_INTERVAL / 1000)`.

---

## 5. Sensor Math — Unit Conversions

All conversion functions live in `backend/app/transforms.py`. Each function is pure Python with no database or HTTP dependencies — fully unit-testable in isolation.

### 5.1 Light: ADC Count → Lux  (`adc_to_lux`)

**Step 1 — Recover voltage from ADC count:**
```
voltage = (adc_value / 4095) × 3.3
```
The ESP32 has a 12-bit ADC (0–4095 maps to 0–3.3 V).

**Step 2 — Back-calculate LDR resistance from the voltage divider:**
```
V_node = 3.3 × R_fixed / (R_LDR + R_fixed)

Solving for R_LDR:
R_LDR = 10,000 × voltage / (3.3 − voltage)   [ohms]
```

**Step 3 — Apply GL5528 power-law to get lux:**
```
lux = 500 / (R_kΩ ^ 0.7)
```
This empirical curve comes from the GL5528 datasheet. Accuracy: ±20 % across 10–1 000 lux.

**Edge case:** If `adc_value == 4095`, the denominator is zero. The function returns `0.0` rather than raising.

```python
def adc_to_lux(adc_value: int) -> float:
    voltage = (adc_value / 4095) * 3.3
    denominator = 3.3 - voltage
    if denominator <= 0.0:
        return 0.0
    ldr_resistance_kohm = (10_000 * voltage / denominator) / 1_000
    lux = 500 / (ldr_resistance_kohm ** 0.7)
    return max(0.0, lux)
```

---

### 5.2 Sound: RMS Integer → dB SPL  (`rms_to_db`)

**Anchor point from the INMP441 datasheet:**
```
420,426 RMS → 94 dB SPL
```

**Formula:**
```
dB SPL = 20 × log₁₀(rms_value / 420,426) + 94
```

**Derivation:**  
The INMP441 has −26 dBFS sensitivity at 94 dB SPL. The 24-bit full-scale integer is 2²³ − 1 ≈ 8,388,607. Accounting for real-world crest factors, the application notes give 420,426 as the RMS at 94 dB SPL.

**Reference values:**
| Sound Level | RMS Integer |
|------------|------------|
| 33 dB (near-silent) | ~600 |
| 40 dB (threshold) | ~1,330 |
| 50 dB (conversation) | ~4,205 |
| 58 dB (busy room) | ~13,300 |
| 65 dB (very loud) | ~53,000 |

```python
def rms_to_db(rms_value: int) -> float:
    if rms_value <= 0:
        return 0.0
    _NOMINAL_RMS_AT_94DB = 420_426
    return 20 * math.log10(rms_value / _NOMINAL_RMS_AT_94DB) + 94
```

---

### 5.3 Motion: Count → Movements/Min  (`compute_movements_per_min`)

The PIR counts interrupt edges over a 5-second window. There are `60 / 5 = 12` such windows per minute:

```
movements_per_min = motion_count × 12
```

This is intentionally simple — the complex part is the occupancy-factor calculation done in the data generator and the comfort score.

---

### 5.4 Apparent Temperature  (`apparent_temperature`)

Before computing comfort, the system calculates how **hot the room actually feels**, which combines temperature and humidity:

**Vapour pressure (Buck 1981 simplified):**
```
e = (RH / 100) × 6.105 × exp(17.27 × T / (237.7 + T))   [hPa]
```

**Apparent temperature (Australian Bureau of Meteorology / Steadman 1994):**
```
AT = T + 0.33 × e − 4.0
```

**Interpretation of each term:**
- `T` — the dry-bulb (thermometer) temperature
- `0.33 × e` — every 3 hPa of extra moisture feels like 1 °C hotter (sweating becomes less effective)
- `−4.0` — convective cooling correction at typical indoor air velocities (~1 m/s)

**Example:**  
T = 25 °C, RH = 70 %  
e = (70/100) × 6.105 × exp(17.27 × 25 / 262.7) = 0.7 × 6.105 × exp(1.644) ≈ 0.7 × 6.105 × 5.17 ≈ 22.1 hPa  
AT = 25 + 0.33 × 22.1 − 4.0 = 25 + 7.3 − 4.0 = **28.3 °C** (feels 3 °C hotter than the thermometer reads)

---

## 6. Comfort Score Algorithm

**File:** `backend/app/transforms.py` → `compute_comfort_score()`

The comfort score is a **weighted sum of three components** (total 100 points):

| Component | Points | Standard Referenced |
|-----------|--------|-------------------|
| Thermal comfort | 40 | ASHRAE 55-2023 |
| Acoustic comfort | 35 | WHO ENV Noise Guidelines 2018 |
| Visual comfort | 25 | EN 12464-1:2021 |

### 6.1 Thermal Comfort (40 pts)

Uses **apparent temperature** (AT), not raw temperature:

```
if temp_min ≤ AT ≤ temp_max:
    thermal_score = 40

else:
    excess = distance AT is outside the comfortable range (°C)
    thermal_score = max(0, 40 × (1 − excess / 8.0))
```

The `8.0` divisor comes from **ASHRAE 55-2023 §5.3** — at 8 °C beyond the comfort boundary the body experiences physiological heat stress. Score decays linearly from 40 → 0 over that 8 °C margin.

**Defaults:** `temp_min = 18 °C`, `temp_max = 26 °C`

---

### 6.2 Acoustic Comfort (35 pts)

Uses a **crowding amplifier** — noise feels worse when there are many people because multiple simultaneous talkers surround you (Klatte et al. 2010):

```
dB_excess      = max(0, sound_db − sound_max_db)
crowding_ratio = clamp(0, (movements_per_min − motion_max) / motion_max, 1)
amplification  = 1.0 + 0.5 × crowding_ratio          [range: 1.0× – 1.5×]
acoustic_score = max(0, 35 − dB_excess × 3.5 × amplification)
```

**Interpretation:**
- If sound is at threshold (40 dB) and room is empty: score = 35 (full points)
- Each dB above threshold costs 3.5 points (×1.0 when empty, ×1.5 when crowded)
- At maximum crowding (2× motion threshold), the penalty per dB increases by 50%

**Default:** `sound_max_db = 40 dB` (WHO recommends 35 dB; +5 dB offset for occupied-room background noise)

---

### 6.3 Visual Comfort (25 pts)

```
if light_min_lux ≤ light_lux ≤ light_max_lux:
    visual_score = 25

else:
    excess = distance lux is outside the comfortable range
    visual_score = max(0, 25 × (1 − excess / 500.0))
```

The 500-lux decay margin is wide because:
- LDR accuracy is ±20 %
- Lux varies across different positions in the room

**Defaults:** `light_min_lux = 300`, `light_max_lux = 500`  
Standard: EN 12464-1:2021 specifies **500 lux maintained** for reading/writing tasks.

---

### 6.4 Score Worked Example

Given: T = 24°C, RH = 55%, sound = 42 dB, lux = 400, motion = 0 mov/min  
Defaults: temp_min=18, temp_max=26, sound_max=40, light_min=300, light_max=500, motion_max=10

**Thermal:**  
e = (55/100) × 6.105 × exp(17.27×24/261.7) ≈ 0.55 × 6.105 × 4.83 ≈ 16.2 hPa  
AT = 24 + 0.33×16.2 − 4.0 = 24 + 5.35 − 4.0 = 25.35 °C → within [18, 26] → **40 pts**

**Acoustic:**  
dB_excess = max(0, 42−40) = 2  
crowding_ratio = 0 (motion=0 < 10)  
amplification = 1.0  
acoustic_score = max(0, 35 − 2×3.5×1.0) = 35 − 7 = **28 pts**

**Visual:**  
400 lux is within [300, 500] → **25 pts**

**Total: 40 + 28 + 25 = 93/100 → "comfortable"**

---

## 7. Condition Classification

**File:** `backend/app/transforms.py` → `classify_reading()`

Each reading gets exactly one label, evaluated in **priority order** (most severe first):

| Priority | Label | Condition tested |
|----------|-------|-----------------|
| 1 | `poor` | comfort_score < 50 |
| 2 | `warm` | apparent_temp > temp_max + 2 °C |
| 3 | `humid` | humidity > 70 % |
| 4 | `noisy` | sound_db > sound_max_db + 5 dB |
| 5 | `dim` | light_lux < light_min_lux − 100 lux |
| 6 | `crowded` | movements_per_min > motion_max × 2 |
| 7 | `comfortable` | comfort_score ≥ 75 |
| 8 | `moderate` | 50 ≤ comfort_score < 75 (fallthrough) |

**Why priority order?**  
A reading cannot be "noisy" and "poor" simultaneously; "poor" is more informative because it captures the cumulative effect. Priority ensures determinism.

**Key insight:** The label thresholds are deliberately offset from comfort thresholds:
- `warm` triggers at `temp_max + 2` — the comfort score already captures mild exceedances; the label only fires when clearly hot
- `dim` triggers at `light_min − 100` — a 100 lux buffer before declaring it dim

---

## 8. Anomaly Detection

**File:** `backend/app/routes/readings.py` → `_detect_anomalies()`

Anomalies are **physically unusual events** (hardware failure, extreme environment), wider than comfort thresholds:

| Metric | Anomaly condition | Human reason |
|--------|------------------|-------------|
| Apparent temp | > temp_max + 5 °C | HVAC failure or direct heat source |
| Apparent temp | < temp_min − 5 °C | Ventilation failure or cold infiltration |
| Humidity | > 78 % | Risk of condensation and mould growth |
| Humidity | < 28 % | Air is excessively dry |
| Sound | > sound_max + 18 dB | Acoustic spike event (>58 dB default) |
| Light | < 100 lux | Lamp failure or blackout |
| Light | > 900 lux | Direct sunlight flooding or fixture fault |
| Motion | > motion_max × 3 | Unusual occupancy / crowd event |

When anomalies are detected, they are **written to the `anomalies` table** with `metric`, `value`, and a human-readable `reason` string.

**Multiple anomalies per reading:** A single reading can generate multiple anomaly records — one per flagged metric.

---

## 9. Backend Deep-Dive (FastAPI)

### File structure

```
backend/app/
├── main.py        Entry point: FastAPI app, CORS, lifespan hook
├── database.py    Engine, session, ORM models, init_db()
├── models.py      Pydantic schemas (SensorPayload, ReadingResponse)
├── transforms.py  Pure sensor math (no DB, no HTTP)
└── routes/
    ├── rooms.py       CRUD for room registry
    ├── readings.py    Ingest + history + correlation
    ├── anomalies.py   Anomaly listing
    ├── thresholds.py  GET/PUT comfort thresholds
    └── insights.py    ML prediction endpoint
```

### main.py explained

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()        # create tables + seed default thresholds
    yield                  # server runs here
```

`lifespan` is FastAPI's modern way to run startup/shutdown code. It replaces the older `@app.on_event("startup")` decorator.

**CORS:** `allow_origins=["*"]` — allows the React frontend (on port 3000) to call the backend (on port 8000) from the browser.

### The ingest pipeline (readings.py)

```python
@router.post("/ingest", status_code=201)
async def ingest(payload: SensorPayload, db: DB):
    # 1. Verify room exists (404 if not registered)
    # 2. Fetch active comfort thresholds
    # 3. run_all_transforms(payload, thresholds) → derived fields
    # 4. Insert SensorReading into DB
    # 5. _detect_anomalies() → insert Anomaly rows if needed
    # 6. Return the reading (201 Created)
```

### Async database pattern

```python
# Dependency injection — FastAPI calls get_db() for every request
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

# Route signature
async def ingest(payload: SensorPayload, db: Annotated[AsyncSession, Depends(get_db)]):
    ...
```

SQLAlchemy's async session is created fresh for every request and automatically closed after.

---

## 10. Database Schema

Four tables in PostgreSQL:

### `rooms`
```sql
id         VARCHAR  PRIMARY KEY  -- slug e.g. "muhabura_p003"
name       VARCHAR  NOT NULL     -- display name e.g. "Muhabura P003"
created_at TIMESTAMPTZ
```

### `sensor_readings`
```sql
id                INTEGER  PRIMARY KEY AUTOINCREMENT
room_id           VARCHAR  REFERENCES rooms(id)
timestamp         TIMESTAMPTZ NOT NULL
-- Raw values from ESP32:
temperature       FLOAT   -- °C
humidity          FLOAT   -- %
motion_count      INTEGER -- PIR count in 5s window
light_raw         INTEGER -- 12-bit ADC (0–4095)
sound_rms         INTEGER -- INMP441 RMS integer
-- Derived by backend:
light_lux         FLOAT   -- converted from light_raw
sound_db          FLOAT   -- converted from sound_rms
movements_per_min FLOAT   -- derived from motion_count
comfort_score     FLOAT   -- 0–100
label             VARCHAR -- e.g. "comfortable", "noisy"
```

### `comfort_thresholds`
```sql
id                  INTEGER PRIMARY KEY
temp_min            FLOAT DEFAULT 18.0
temp_max            FLOAT DEFAULT 26.0
humidity_min        FLOAT DEFAULT 30.0
humidity_max        FLOAT DEFAULT 60.0
sound_max_db        FLOAT DEFAULT 40.0
light_min_lux       FLOAT DEFAULT 300.0
light_max_lux       FLOAT DEFAULT 500.0
motion_max_per_min  FLOAT DEFAULT 10.0
updated_at          TIMESTAMPTZ
```

Only one row is ever active. `GET /api/thresholds` returns it; `PUT /api/thresholds` updates it (partial update supported).

### `anomalies`
```sql
id         INTEGER PRIMARY KEY
room_id    VARCHAR REFERENCES rooms(id)
timestamp  TIMESTAMPTZ NOT NULL
metric     VARCHAR  -- e.g. "sound_db", "light_lux"
value      FLOAT    -- the anomalous value
reason     VARCHAR  -- human-readable explanation
reading_id INTEGER  REFERENCES sensor_readings(id)
```

---

## 11. API Reference

Base URL: `http://localhost:8000`  
Interactive docs: `http://localhost:8000/docs`

### Ingest (ESP32 → Backend)

```
POST /api/ingest
Content-Type: application/json

{
  "room_id":      "muhabura_p003",
  "timestamp":    "2026-05-06T10:30:00Z",
  "temperature":  24.1,
  "humidity":     58.0,
  "motion_count": 2,
  "light_raw":    530,
  "sound_rms":    18400
}

Response 201:
{
  "id": 42,
  "room_id": "muhabura_p003",
  "timestamp": "2026-05-06T10:30:00Z",
  "temperature": 24.1, "humidity": 58.0,
  "motion_count": 2, "light_raw": 530, "sound_rms": 18400,
  "light_lux": 378.4, "sound_db": 46.8,
  "movements_per_min": 24.0,
  "comfort_score": 72.5,
  "label": "moderate"
}
```

### Key GET endpoints

| Endpoint | What it returns |
|----------|----------------|
| `GET /api/rooms` | All registered rooms |
| `GET /api/rooms/{id}/latest` | Most recent reading snapshot |
| `GET /api/rooms/{id}/summary` | 24-hour avg/min/max for all metrics |
| `GET /api/rooms/{id}/readings?limit=100` | Paginated reading history |
| `GET /api/rooms/{id}/correlation?limit=500` | 5×5 Pearson correlation matrix |
| `GET /api/rooms/{id}/label-distribution` | Count of each label (last 24 h) |
| `GET /api/anomalies?room_id=x` | All anomaly records, filterable |
| `GET /api/thresholds` | Current comfort thresholds |
| `PUT /api/thresholds` | Update thresholds (partial update OK) |
| `GET /api/rooms/{id}/predict` | ML prediction for latest reading |

---

## 12. Frontend (React)

### Page overview

| Page | Route | Key components |
|------|-------|---------------|
| Room List | `/` | `RoomCard` — shows name, score, label |
| Room Detail | `/rooms/:id` | `MetricCard`, `ComfortScore`, `MultiLineChart`, label distribution bars |
| Metric Detail | `/rooms/:id/metrics/:metric` | `SingleMetricChart` — full time series |
| Anomalies | `/anomalies` | Table of flagged events |
| Insights | `/insights` | Correlation heatmap, label distribution, ML prediction card |
| Settings | `/settings` | Threshold editor (live PUT), calibration reference |

### Routing (App.jsx)

```jsx
<Routes>
  <Route path="/"                               element={<RoomList />} />
  <Route path="/rooms/:room_id"                 element={<RoomDetail />} />
  <Route path="/rooms/:room_id/metrics/:metric" element={<MetricDetail />} />
  <Route path="/anomalies"                      element={<Anomalies />} />
  <Route path="/insights"                       element={<Insights />} />
  <Route path="/settings"                       element={<Settings />} />
</Routes>
```

### API client (api/client.js)

All HTTP calls go through a central Axios client configured with `REACT_APP_BACKEND_URL`. This keeps the backend URL in one place and makes it easy to add auth headers later.

### Key design decisions

1. **Polling, not WebSockets** — The dashboard polls every few seconds. Simpler than WebSockets; sufficient for 5-second sensor intervals.
2. **Colour coding** — Comfort score drives card colour: green ≥ 75, yellow 50–74, red < 50.
3. **Recharts** — `<LineChart>`, `<AreaChart>` from Recharts render SVG; responsive containers adapt to screen width.

---

## 13. Machine Learning Pipeline

### Overview

The Jupyter notebook `analysis/studyspace_analysis.ipynb` trains two models:

1. **Classifier** — predicts condition label (8 classes) from sensor features
2. **Regressor** — predicts comfort score (continuous 0–100) from sensor features

### Features used

```python
features = ["temperature", "humidity", "sound_db", "light_lux", "movements_per_min"]
target_class  = "label"           # 8 classes
target_regression = "comfort_score"  # float 0–100
```

### Pipeline steps

| Notebook Cell | Action |
|---------------|--------|
| 1 | Imports, matplotlib dark style |
| 2 | Load data from PostgreSQL (`psycopg2` driver) |
| 3 | Summary statistics + coefficient of variation |
| 4 | Label distribution table |
| 5 | Data cleaning — drop nulls, engineer `hour`, `weekday`, `is_weekday` |
| 6 | MinMaxScaler normalisation [0, 1] → `feature_scaler.pkl` |
| 7 | Time-series plots (last 500 readings) |
| 8 | Pearson correlation heatmap (seaborn, lower-triangle mask) |
| 9 | Bootstrap augmentation — 2× dataset, 2% Gaussian noise, seed 42 |
| 10 | IQR outlier detection (Tukey 1.5× fence) |
| 11 | RandomForest vs LogisticRegression vs DecisionTree comparison |
| 12 | Decision table — 8 rule rows → facility action |
| 13 | LinearRegression vs RandomForestRegressor for comfort score |
| 14 | Save `comfort_classifier.pkl` + `feature_scaler.pkl` to `backend/models/` |

### Bootstrap augmentation (Cell 9)

```python
# Double the dataset by sampling with replacement + adding 2% Gaussian noise
augmented = original.sample(n=len(original), replace=True, random_state=42)
for col in feature_cols:
    noise = np.random.normal(0, 0.02 * augmented[col].std(), len(augmented))
    augmented[col] += noise
```

**Why augment?** The classifier needs diverse training examples. With 500 readings, some labels (e.g., "poor") may have few examples. Augmentation balances the training set.

### ML prediction endpoint (insights.py)

```
GET /api/rooms/{room_id}/predict

Response:
{
  "predicted_label": "comfortable",
  "confidence": 0.92,
  "rule_label": "comfortable",
  "rule_ml_agree": true,
  "feature_importances": {
    "temperature": 0.18,
    "humidity": 0.22,
    "sound_db": 0.31,
    "light_lux": 0.15,
    "movements_per_min": 0.14
  }
}
```

If the model files don't exist yet, returns `{"status": "not_trained"}`.

---

## 14. Running the Project

### Quick start (Docker — recommended)

```bash
# 1. .env is already created — verify it:
cat .env

# 2. Start everything (images already built):
docker compose up -d

# 3. Open the dashboard:
#    http://localhost:3000

# 4. Check API docs:
#    http://localhost:8000/docs

# 5. Seed historical data (run inside the backend container):
docker compose exec backend python scripts/generate_data.py --bulk 500

# 6. Stop everything:
docker compose down
```

### Port map

| Service | Container port | Host port |
|---------|---------------|-----------|
| Frontend (React) | 3000 | 3000 |
| Backend (FastAPI) | 8000 | 8000 |
| PostgreSQL | 5432 | 5433 |

> PostgreSQL is on host port **5433** to avoid conflicts with any local PostgreSQL instance.

### Manual (development) setup

```bash
# Backend — from the backend/ directory
python -m venv .venv
.venv\Scripts\activate           # Windows
pip install -r requirements.txt
cp .env.example .env             # edit DATABASE_URL
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend — from the frontend/ directory
npm install
cp .env.example .env             # REACT_APP_BACKEND_URL=http://localhost:8000
npm start
```

### Running the data generator

```bash
# Live mode — posts one reading every 5 seconds
docker compose exec backend python scripts/generate_data.py

# Bulk mode — 1000 historical readings (no sleep)
docker compose exec backend python scripts/generate_data.py --bulk 1000
```

The generator simulates realistic Kigali conditions: seasonal temperature/humidity offsets, diurnal temperature drift, occupancy-aware noise and motion, and random anomaly injection (~3.5% of readings).

---

## 15. Data Flow — End-to-End Trace

Trace a single sensor reading from hardware to dashboard:

```
1. ESP32 firmware (every 5 s):
   - Reads DHT22: temperature=24.1, humidity=58.0
   - Counts PIR interrupts: motion_count=2
   - Reads ADC: light_raw=530
   - Computes INMP441 RMS: sound_rms=18400
   - HTTP POST → http://<backend>:8000/api/ingest

2. FastAPI /api/ingest handler:
   a. Pydantic validates SensorPayload
   b. Checks Room exists in DB (404 if not)
   c. Loads ComfortThreshold from DB
   d. Calls run_all_transforms(payload, thresholds):
      - adc_to_lux(530) → 378 lux
      - rms_to_db(18400) → 46.8 dB
      - compute_movements_per_min(2) → 24.0 mov/min
      - apparent_temperature(24.1, 58.0) → 25.0 °C
      - compute_comfort_score(...) → 72.5
      - classify_reading(...) → "moderate"
   e. Inserts SensorReading into sensor_readings table
   f. Calls _detect_anomalies(reading, thresholds)
      - sound_db 46.8 < 40+18=58 → no sound anomaly
      - lux 378 > 100, < 900 → no light anomaly
      → no anomalies in this reading
   g. Returns ReadingResponse JSON, status 201

3. React dashboard (polling /api/rooms/muhabura_p003/latest):
   - Receives the reading
   - MetricCard shows: 24.1°C, 58%, 378 lux, 46.8 dB, 24 mov/min
   - ComfortScore gauge shows: 72.5 / 100
   - Label badge shows: "moderate" (yellow)
   - Chart updates with new data point
```

---

## 16. Standards and Research Referenced

| Standard | Applied to |
|----------|-----------|
| **ASHRAE Standard 55-2023** | Apparent temperature formula; thermal comfort bounds (18–26 °C); 8 °C stress boundary in score decay; humidity bounds (30–60 %) |
| **Steadman (1994) / Australian BOM** | AT = T + 0.33e − 4.0 formula |
| **WHO Environmental Noise Guidelines (2018)** | 35 dB LAeq classroom recommendation → system uses 40 dB accounting for background |
| **EN 12464-1:2021** | 500 lux maintained for reading/writing tasks |
| **Klatte, Bergström, Lachmann (2010)** *Noise & Health* | Scientific basis for the crowding amplifier in acoustic scoring |
| **GL5528 LDR Datasheet** | Power-law curve `lux = 500 / R_kΩ^0.7`, ±20% accuracy |
| **INMP441 Datasheet / Application Notes** | −26 dBFS at 94 dB SPL; 420,426 RMS anchor |
| **Tukey (1977)** | 1.5 × IQR fence for outlier detection in the notebook |

---

## 17. Exam-Style Questions and Answers

### Q1. Why does the system use apparent temperature instead of raw temperature for comfort scoring?

**Answer:** Temperature and humidity are physiologically inseparable. At high humidity, sweating becomes less effective because the air is nearly saturated with moisture, so the body cannot cool itself. A room at 26 °C and 80 % RH feels significantly hotter than 26 °C at 40 % RH. The apparent temperature (AT = T + 0.33e − 4.0) combines both into a single "felt temperature" value, allowing the comfort model to score them with a single threshold rather than two independent checks that would miss their interaction.

---

### Q2. Explain the crowding amplifier in the acoustic comfort score.

**Answer:** The crowding amplifier accounts for the psychoacoustic effect discovered by Klatte et al. (2010): when multiple people are talking simultaneously, noise surrounds the listener from all directions and cannot be attenuated by moving away or turning toward a single source. The system measures this via the PIR motion sensor (movements per minute as an occupancy proxy). When occupancy exceeds the `motion_max` threshold, the penalty per dB of excess noise is multiplied by up to 1.5×, representing up to 50% extra discomfort from the same decibel level in a crowded room.

---

### Q3. Why are anomaly thresholds wider than comfort thresholds?

**Answer:** Comfort thresholds define the *ideal* range for studying. Anomaly thresholds flag *physically unusual or potentially dangerous* events. For example:
- Comfort: `sound_db > 40 dB` starts reducing the score
- Anomaly: `sound_db > 58 dB` is flagged (18 dB above threshold)

The wide gap prevents anomaly alerts from firing on normal discomfort events. An anomaly means something is physically wrong (HVAC failure, lamp failure, extreme noise event) — not just "a bit warm today."

---

### Q4. The ESP32 sends `light_raw = 530` (ADC count). Calculate the illuminance in lux.

**Answer:**
```
voltage = 530 / 4095 × 3.3 = 0.4270 V
R_LDR  = 10,000 × 0.4270 / (3.3 − 0.4270) = 4270 / 2.873 = 1486 Ω = 1.486 kΩ
lux    = 500 / (1.486 ^ 0.7) = 500 / 1.321 ≈ 378 lux
```
Result: approximately **378 lux** (comfortable — within the 300–500 lux target range).

---

### Q5. What happens if an ESP32 sends a reading for a room_id that was not registered?

**Answer:** The `POST /api/ingest` handler first queries the `rooms` table for the given `room_id`. If no matching row is found, it raises `HTTPException(status_code=404, detail="Room not registered...")`. The ESP32 receives a 404 response. No reading is saved, no transforms are run, and no anomaly check occurs. The room must be registered first in the Settings page (which calls `POST /api/rooms`) before the ESP32 can submit data.

---

### Q6. Describe the data flow from sensor to dashboard for a sound anomaly event.

**Answer:**
1. INMP441 reports very high RMS (e.g., 110,000 → rms_to_db gives ~68 dB)
2. Backend ingests the reading; `run_all_transforms` sets `sound_db = 68.0`, `label = "noisy"` (68 > 40+5=45)
3. `_detect_anomalies` checks: 68 > 40+18 = 58 → anomaly flag fires
4. An `Anomaly` row is inserted: `metric="sound_db", value=68.0, reason="Sound level 68.0 dB is 28.0 dB above threshold — acoustic spike event"`
5. The React Anomalies page polls `GET /api/anomalies`, fetches the new record, and displays it in the table with the reason string.

---

### Q7. Why does the system use async SQLAlchemy instead of synchronous?

**Answer:** FastAPI is built on asyncio. If the database calls were synchronous, every HTTP request would block the event loop thread while waiting for the database to respond, preventing other requests from being handled concurrently. With `asyncpg` + SQLAlchemy async, the event loop can service other requests while waiting for I/O. This is critical for an IoT system where many ESP32 devices might be posting simultaneously.

---

### Q8. What is the purpose of bootstrap augmentation in the ML notebook?

**Answer:** The training dataset from the database may be unbalanced — some labels (like "poor" or "crowded") appear rarely because they represent unusual conditions. Bootstrap augmentation doubles the dataset by sampling with replacement and adding 2% Gaussian noise to each feature. This:
1. Increases the number of rare-class examples for better classifier training
2. Adds slight variation so the model generalises rather than memorising exact values
3. Is repeatable (seed=42) so results are reproducible

---

### Q9. How does the system handle the case where the ML model files don't exist?

**Answer:** The `GET /api/rooms/{id}/predict` endpoint in `insights.py` checks whether `backend/models/comfort_classifier.pkl` and `feature_scaler.pkl` exist before trying to load them. If either file is missing, it returns `{"status": "not_trained"}` instead of a prediction. The React Insights page handles this gracefully, showing a message that the model hasn't been trained yet. The user must run the Jupyter notebook to train and save the model files.

---

### Q10. Calculate the comfort score for: T=30°C, RH=80%, sound=55dB, lux=450, motion=5 mov/min (defaults: temp_max=26, sound_max=40, light_min=300, light_max=500, motion_max=10)

**Answer:**

**Apparent temperature:**  
e = (80/100) × 6.105 × exp(17.27×30 / 267.7) ≈ 0.8 × 6.105 × exp(1.935) ≈ 0.8 × 6.105 × 6.92 ≈ 33.8 hPa  
AT = 30 + 0.33×33.8 − 4.0 = 30 + 11.15 − 4.0 = **37.15 °C**

**Thermal score:**  
excess = 37.15 − 26 = 11.15 °C (more than 8°C beyond limit)  
thermal_score = max(0, 40 × (1 − 11.15/8)) = max(0, 40 × (−0.394)) = **0 pts**

**Acoustic score:**  
dB_excess = 55 − 40 = 15 dB  
crowding_ratio = 0 (motion=5 < motion_max=10)  
amplification = 1.0  
acoustic_score = max(0, 35 − 15×3.5×1.0) = max(0, 35−52.5) = **0 pts**

**Visual score:**  
450 lux is within [300, 500] → **25 pts**

**Total: 0 + 0 + 25 = 25/100 → label = "poor" (score < 50)**

---

*End of Study Guide*  
*For live API exploration: http://localhost:8000/docs*  
*For the dashboard: http://localhost:3000*
