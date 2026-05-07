# StudySpace IoT

> **Real-time environmental monitoring for University of Rwanda study rooms.**  
> An end-to-end IoT system that collects five sensor streams from an ESP32, transforms them into calibrated physical units, scores room comfort using peer-reviewed physiological models, detects anomalies, classifies conditions with a trained Random Forest, and presents everything in a live React dashboard.

![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?style=flat-square&logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?style=flat-square&logo=postgresql&logoColor=white)
![Arduino](https://img.shields.io/badge/ESP32-Arduino-00979D?style=flat-square&logo=arduino&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)
![scikit-learn](https://img.shields.io/badge/scikit--learn-1.4-F7931E?style=flat-square&logo=scikitlearn&logoColor=white)

---

## Table of Contents

- [Architecture](#architecture)
- [Hardware](#hardware)
- [How It Works — The Science](#how-it-works--the-science)
- [Project Layout](#project-layout)
- [Quick Start (Docker)](#quick-start-docker)
- [Developer Setup (Manual)](#developer-setup-manual)
- [Firmware](#firmware)
- [API Reference](#api-reference)
- [Frontend Pages](#frontend-pages)
- [Analysis Notebook](#analysis-notebook)
- [Research & Standards](#research--standards)
- [Configuration Reference](#configuration-reference)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Physical Layer                                                     │
│                                                                     │
│  DHT22 ──┐                                                          │
│  PIR ────┤                                                          │
│  LDR ────┼── ESP32 ──(HTTP POST / WiFi)──► FastAPI Backend          │
│  INMP441 ┤                                                          │
└──────────┘                                                          │
                                                                      │
┌─────────────────────────────────────────────────────────────────────┤
│  Backend  (Python · FastAPI · asyncpg · SQLAlchemy)                 │
│                                                                     │
│  POST /api/ingest                                                   │
│    ├── adc_to_lux()               raw ADC → lux (GL5528 power-law) │
│    ├── rms_to_db()                RMS int → dB SPL (INMP441 anchor) │
│    ├── compute_movements_per_min()  count/window → mov/min          │
│    ├── compute_comfort_score()    3-component score 0–100           │
│    ├── classify_reading()         8-class label (priority tree)     │
│    └── _detect_anomalies()        IQR-style threshold checks        │
│                                                                     │
│  GET endpoints → PostgreSQL 15 (async reads)                        │
└─────────────────────────────────────────────────────────────────────┤
│  Analysis  (Jupyter · pandas · scikit-learn · seaborn)              │
│                                                                     │
│  studyspace_analysis.ipynb                                          │
│    ├── Load from PostgreSQL via psycopg2                            │
│    ├── Summary stats + IQR outlier detection                        │
│    ├── Pearson correlation heatmap                                   │
│    ├── Bootstrap augmentation (2× dataset, 2% Gaussian noise)       │
│    ├── RandomForest · LogisticRegression · DecisionTree compared    │
│    ├── LinearRegression vs RandomForest regressor (comfort score)   │
│    └── Save comfort_classifier.pkl + feature_scaler.pkl             │
└─────────────────────────────────────────────────────────────────────┤
│  Frontend  (React 18 · Recharts · React Router 6)                   │
│                                                                     │
│  /               → RoomList    — cards for every registered room    │
│  /rooms/:id      → RoomDetail  — live metrics, score, label dist    │
│  /rooms/:id/metrics/:m → MetricDetail — time-series deep-dive       │
│  /anomalies      → Anomalies   — flagged events with reasons        │
│  /insights       → Insights    — correlation heatmap + ML pred.     │
│  /settings       → Settings    — thresholds + calibration ref.      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Hardware

Each sensor was chosen to cover one dimension of study-room comfort at low cost and 3.3 V logic compatibility with the ESP32.

| Sensor | Measures | Why this sensor |
|--------|----------|-----------------|
| **DHT22** | Temperature (°C) + Relative Humidity (%) | Single-wire protocol, ±0.5 °C / ±2–5 % RH accuracy, mandatory minimum 2 s between reads. Temperature and humidity are read together because they are physiologically inseparable — the *apparent* temperature depends on both. |
| **HC-SR501** (PIR) | Motion events | Passive infrared, triggers on moving heat sources. Interrupt-driven counting over a 5-second window gives a proxy for room occupancy without cameras or identifiable data. |
| **GL5528** (LDR) | Illuminance (lux) | Wired as a voltage divider with a 10 kΩ fixed resistor. Resistance decreases with light, raising ADC voltage. Converted to lux with the GL5528 power-law curve: `lux = 500 / R_kΩ^0.7`. Accurate ±20 % across 10–1 000 lux. |
| **INMP441** (MEMS Mic) | Sound pressure level (dB SPL) | I2S digital output eliminates the noise of an analog amplifier stage. 24-bit depth gives high dynamic range. RMS computed over 1 024 samples, anchored to the datasheet calibration point (420 426 RMS = 94 dB SPL). |

### Wiring Summary

```
ESP32 pin   Sensor       Signal
────────────────────────────────────────────────────────────────
GPIO 4      DHT22        Data (10 kΩ pull-up to 3.3 V)
GPIO 27     HC-SR501     Digital output (interrupt, RISING edge)
GPIO 34     LDR divider  ADC1 ch6 — input-only; never drive HIGH
GPIO 14     INMP441      BCLK  (I2S serial clock)
GPIO 15     INMP441      LRCL  (I2S word select — L/R pin → GND)
GPIO 32     INMP441      DOUT  (I2S data out from mic)
```

See [`firmware/main/`](firmware/main/) for the full pin reference and circuit notes.

---

## How It Works — The Science

### 1. Unit Conversions

**Light (ADC → lux)**

The GL5528 LDR obeys an inverse power law: resistance falls as illuminance rises. The voltage divider node voltage is:

```
V_node = 3.3 × R_fixed / (R_LDR + R_fixed)
```

Inverting gives `R_LDR = 10 kΩ × V / (3.3 − V)`. The GL5528 empirical power-law then gives:

```
lux = 500 / R_kΩ^0.7
```

**Sound (RMS integer → dB SPL)**

The INMP441 datasheet states −26 dBFS sensitivity at 94 dB SPL. Anchoring to the practical RMS figure of 420 426 at 94 dB SPL:

```
dB SPL = 20 × log₁₀(rms / 420 426) + 94
```

**Motion (count → movements/min)**

The firmware counts PIR interrupts over a 5-second window (12 windows/min):

```
movements_per_min = motion_count × 12
```

### 2. Comfort Score (0–100)

Three components replace five independent sub-scores because temperature and humidity are physiologically coupled, and acoustic annoyance is amplified by crowding.

#### Thermal Comfort — 40 pts

Apparent temperature (AT) combines dry-bulb temperature and relative humidity into a single felt-temperature value using the **Australian Bureau of Meteorology formula** (Steadman 1994), validated against ASHRAE Standard 55 for still-air indoor conditions:

```
e  = (RH / 100) × 6.105 × exp(17.27 × T / (237.7 + T))    [vapour pressure, hPa]
AT = T + 0.33 × e − 4.0                                      [apparent °C]
```

The coefficient **0.33** converts hPa of additional water vapour into perceived °C of extra warmth — every 3 hPa is felt as roughly 1 °C hotter. The −4.0 term is a convective loss correction at typical indoor air velocities. AT is scored linearly against the configured temperature bounds, decaying to 0 at 8 °C beyond either limit (the physiological stress boundary in ASHRAE 55-2023 §5.3).

#### Acoustic Comfort — 35 pts

WHO Environmental Noise Guidelines (2018) recommend < 35 dB LAeq for classrooms; 40 dB is the configured threshold, accounting for occupied-room background noise. Crowding amplifies the penalty because noise from multiple simultaneous talkers surrounds the listener and cannot be attenuated the way a single point source can (Klatte et al., *Noise & Health*, 2010):

```
dB_excess      = max(0, sound_db − sound_max_db)
crowding_ratio = clamp(0, (motion − motion_max) / motion_max, 1)
amplification  = 1.0 + 0.5 × crowding_ratio          [range: 1.0× – 1.5×]
acoustic_score = max(0, 35 − dB_excess × 3.5 × amplification)
```

#### Visual Comfort — 25 pts

EN 12464-1:2021 specifies a maintained illuminance of **500 lux** for reading and writing tasks. Score is full within the configured lux band, decaying to 0 at ±500 lux beyond either bound. The wide decay margin accounts for ±20 % LDR sensor accuracy and natural variation across different positions in the room.

### 3. Condition Classification (8 classes)

Each reading is assigned exactly one label by evaluating conditions in severity order:

| Priority | Label | Condition |
|----------|-------|-----------|
| 1 | `poor` | comfort_score < 50 |
| 2 | `warm` | apparent_temp > temp_max + 2 °C |
| 3 | `humid` | humidity > 70 % |
| 4 | `noisy` | sound_db > sound_max + 5 dB |
| 5 | `dim` | light_lux < light_min − 100 lux |
| 6 | `crowded` | movements_per_min > motion_max × 2 |
| 7 | `comfortable` | comfort_score ≥ 75 |
| 8 | `moderate` | 50 ≤ comfort_score < 75 |

### 4. Anomaly Detection

Anomaly thresholds are deliberately wider than comfort thresholds to flag physically unusual events (hardware failures, extreme environmental events) rather than minor discomfort:

| Metric | Anomaly condition |
|--------|------------------|
| Apparent temperature | > temp_max + 5 °C or < temp_min − 5 °C |
| Humidity | > 78 % or < 28 % |
| Sound | > sound_max + 18 dB |
| Light | < 100 lux or > 900 lux |
| Motion | > motion_max × 3 |

---

## Project Layout

```
studyspace-iot/
├── firmware/
│   └── main/                      Arduino sketch for the ESP32
│       ├── main.ino               WiFi, NTP, HTTP POST loop
│       ├── sensors.h              DHT22, PIR, LDR, INMP441 drivers
│       └── config.h               WiFi, pins, timing — edit before flashing
│
├── backend/                       Python / FastAPI service
│   ├── app/
│   │   ├── main.py                App entry point, CORS, router wiring
│   │   ├── database.py            SQLAlchemy ORM (4 tables), async engine
│   │   ├── models.py              Pydantic request/response schemas
│   │   ├── transforms.py          Pure sensor math (unit conversions, scoring)
│   │   └── routes/
│   │       ├── rooms.py           CRUD for room registry
│   │       ├── readings.py        Ingest + history + correlation endpoints
│   │       ├── anomalies.py       Anomaly listing with filters
│   │       ├── thresholds.py      GET/PUT comfort thresholds
│   │       └── insights.py        ML prediction endpoint
│   ├── models/                    Trained artifacts (created by notebook)
│   │   ├── comfort_classifier.pkl
│   │   └── feature_scaler.pkl
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
│
├── frontend/                      React 18 single-page app
│   ├── src/
│   │   ├── App.jsx                Router, nav bar
│   │   ├── api/client.js          Axios API client (all endpoints)
│   │   ├── pages/                 Six full-page views (see Frontend Pages)
│   │   └── components/            Shared chart and card components
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
│
├── analysis/
│   ├── studyspace_analysis.ipynb  12-cell analysis + ML training notebook
│   └── requirements.txt           Analysis-only Python dependencies
│
├── docker-compose.yml             Orchestrates db + backend + frontend
├── .env.example                   Root environment template
└── README.md
```

---

## Quick Start (Docker)

The fastest path to a running system. Requires Docker ≥ 24 and Docker Compose v2.

```bash
# 1. Clone
git clone <repo-url> studyspace-iot
cd studyspace-iot

# 2. Configure environment
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD and REACT_APP_BACKEND_URL at minimum

# 3. Start everything
docker compose up --build

# Services:
#   Frontend   →  http://localhost:3000
#   API docs   →  http://localhost:8000/docs
#   PostgreSQL →  localhost:5432
```

> **First run:** the backend prints its local LAN IP at startup. Use that IP (not `localhost`) in `firmware/main/config.h → BACKEND_URL` before flashing the ESP32, so the device can reach the backend over your network.

---

## Developer Setup (Manual)

Useful for faster iteration — both sides hot-reload.

### Prerequisites

- Python 3.11+
- Node.js 20+
- PostgreSQL 15 running locally (or `docker compose up studyspace_db`)

### Backend

```bash
cd backend

python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env
# Edit DATABASE_URL → postgresql+asyncpg://iot_user:yourpassword@localhost:5432/studyspace_iot

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Tables are created automatically on startup. API docs at `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
npm install

cp .env.example .env
# REACT_APP_BACKEND_URL=http://localhost:8000

npm start         # served on http://0.0.0.0:3000
```

### Analysis Notebook

The notebook reuses the backend virtual environment. Install the three extra packages once:

```bash
cd backend
source .venv/bin/activate
pip install seaborn psycopg2-binary ipykernel
python -m ipykernel install --user --name studyspace-venv --display-name "StudySpace (venv)"
```

Open `analysis/studyspace_analysis.ipynb` in VS Code, select the **StudySpace (venv)** kernel, and **Run All**. The notebook loads data from PostgreSQL, trains the classifier, and saves the model artifacts to `backend/models/`. The Insights page will show live ML predictions after that.

---

## Firmware

See [`firmware/main/`](firmware/main/) for the full sketch and detailed wiring notes.

**Before flashing, edit [`firmware/main/config.h`](firmware/main/config.h):**

```c
#define WIFI_SSID    "your_network"
#define WIFI_PASSWORD "your_password"
#define BACKEND_URL  "http://<backend-LAN-ip>:8000/api/ingest"
#define ROOM_ID      "muhabura_1r01"   // must match a room registered in Settings
```

Register the matching room slug in **Settings → Rooms** in the dashboard before the ESP32 starts posting — the backend returns HTTP 404 for payloads from unregistered rooms.

**Timing:** `SEND_INTERVAL` defaults to 5 000 ms (DHT22 requires ≥ 2 000 ms between reads). If you change this interval, update `_WINDOWS_PER_MINUTE` in [`backend/app/transforms.py`](backend/app/transforms.py) to match `60 / (SEND_INTERVAL / 1000)`.

**Required Arduino libraries** (install via Library Manager):

- `DHT sensor library` — Adafruit
- `Adafruit Unified Sensor` — Adafruit

---

## API Reference

All endpoints are prefixed `/api`. Interactive docs at `/docs`.

### Rooms

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/rooms` | List all registered rooms |
| `POST` | `/api/rooms` | Register a new room (auto-generates slug ID from name) |
| `GET` | `/api/rooms/{room_id}` | Get a single room |

### Readings & Ingest

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ingest` | Accept a sensor payload. Runs all transforms and anomaly checks before persisting. |
| `GET` | `/api/rooms/{room_id}/readings` | Paginated reading history |
| `GET` | `/api/rooms/{room_id}/latest` | Most recent reading snapshot |
| `GET` | `/api/rooms/{room_id}/summary` | 24-hour aggregated stats |
| `GET` | `/api/rooms/{room_id}/correlation` | Pearson correlation matrix (last N readings) |
| `GET` | `/api/rooms/{room_id}/label-distribution` | Condition label counts for the last 24 h |

### Anomalies

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/anomalies` | Global anomaly list (filterable by room, date range, limit) |
| `GET` | `/api/rooms/{room_id}/anomalies` | Anomalies for one room |

### Thresholds

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/thresholds` | Retrieve active comfort thresholds |
| `PUT` | `/api/thresholds` | Update thresholds (partial update supported) |

### Insights (ML)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/rooms/{room_id}/predict` | ML prediction for the room's latest reading. Returns `status: "not_trained"` until the notebook has been run. |

**Ingest payload:**

```json
{
  "room_id":      "muhabura_1r01",
  "timestamp":    "2026-04-23T10:30:00+02:00",
  "temperature":  24.1,
  "humidity":     58.0,
  "motion_count": 2,
  "light_raw":    530,
  "sound_rms":    18400
}
```

The backend derives `light_lux`, `sound_db`, `movements_per_min`, `comfort_score`, and `label` before persisting.

---

## Frontend Pages

| Page | Route | What it shows |
|------|-------|---------------|
| **Rooms** | `/` | Card grid — name, latest comfort score (colour-coded), current condition label |
| **Room Detail** | `/rooms/:id` | Live metric cards, comfort score gauge, 24 h time-series chart, condition label distribution bars, scientific explanation panel citing ASHRAE 55 / WHO / EN 12464-1 |
| **Metric Detail** | `/rooms/:id/metrics/:metric` | Full-resolution time-series for one sensor; min/mean/max summary |
| **Anomalies** | `/anomalies` | Table of flagged events with metric, value, and human-readable reason; filter by room |
| **Insights** | `/insights` | Pearson correlation heatmap; condition label distribution; ML prediction card showing predicted label, confidence, rule vs ML agreement, and feature importances |
| **Settings** | `/settings` | Comfort threshold editor (live PUT); sensor calibration reference documenting every conversion formula, its accuracy, and the standard it references |

---

## Analysis Notebook

[`analysis/studyspace_analysis.ipynb`](analysis/studyspace_analysis.ipynb) — 12 cells covering the full analysis pipeline:

| # | Content |
|---|---------|
| 1 | Imports, matplotlib dark-mode style |
| 2 | Load all readings from PostgreSQL (forces psycopg2 driver; works alongside the asyncpg backend without conflict) |
| 3 | Summary statistics with coefficient of variation |
| 4 | Label distribution table |
| 5 | Data cleaning — drop nulls, engineer `hour`, `weekday`, `is_weekday` features |
| 6 | MinMaxScaler normalisation to [0, 1] |
| 7 | Time-series plots of the last 500 readings across all five sensors |
| 8 | Pearson correlation heatmap (seaborn, lower-triangle mask) with printed interpretation |
| 9 | Bootstrap augmentation — 2× dataset via replacement sampling + 2% σ Gaussian noise per feature (NumPy, seed 42) |
| 10 | IQR outlier detection (Tukey 1.5× fence) — per-metric bounds and box plots |
| 11 | Classification: RandomForest vs LogisticRegression vs DecisionTree — accuracy, classification report, confusion matrix; rule vs ML agreement analysis |
| 12 | Decision table — 8-row if-then rule → label → recommended facility action |
| 13 | Regression: LinearRegression vs RandomForestRegressor predicting `comfort_score` — R², RMSE, actual vs predicted scatter |
| 14 | Save `comfort_classifier.pkl` and `feature_scaler.pkl` to `backend/models/` |

---

## Research & Standards

| Standard / Source | Applied to |
|-------------------|------------|
| **ASHRAE Standard 55-2023** — *Thermal Environmental Conditions for Human Occupancy* | Apparent temperature formula; thermal comfort bounds; 8 °C stress boundary used in score decay |
| **Steadman (1994) / Australian Bureau of Meteorology** | BOM apparent temperature formula `AT = T + 0.33e − 4.0` |
| **WHO Environmental Noise Guidelines for the European Region (2018)** | Classroom noise threshold (35 dB LAeq recommended; 40 dB threshold accounting for occupied-room background) |
| **EN 12464-1:2021** — *Light and Lighting — Lighting of Work Places* | 500 lux maintained illuminance target for reading/writing tasks |
| **Klatte et al. (2010)**, *Noise & Health* | Justification for the crowding amplifier in acoustic scoring |
| **GL5528 LDR Datasheet** | Power-law conversion curve `lux = 500 / R_kΩ^0.7`, accurate ±20 % at 10–1 000 lux |
| **INMP441 Datasheet / Application Notes** | −26 dBFS sensitivity at 94 dB SPL; 420 426 RMS anchor for dB SPL conversion |
| **Tukey (1977)** | 1.5 × IQR fence for statistical outlier classification |

---

## Configuration Reference

### Root `.env` (Docker Compose)

```ini
POSTGRES_USER=iot_user
POSTGRES_PASSWORD=yourpassword
POSTGRES_DB=studyspace_iot

# asyncpg URL for the FastAPI backend container
DATABASE_URL=postgresql+asyncpg://iot_user:yourpassword@studyspace_db:5432/studyspace_iot

# Shown to the frontend at build time
REACT_APP_BACKEND_URL=http://localhost:8000
```

### Comfort Thresholds (adjustable in the Settings page or via `PUT /api/thresholds`)

| Threshold | Default | Standard reference |
|-----------|---------|-------------------|
| `temp_min` | 18 °C | ASHRAE 55 adaptive comfort lower bound |
| `temp_max` | 26 °C | ASHRAE 55 tropical comfort upper bound |
| `humidity_min` | 30 % | ASHRAE 55 §5.1 |
| `humidity_max` | 60 % | ASHRAE 55 §5.1 |
| `sound_max_db` | 40 dB | WHO (2018) + occupied-room background offset |
| `light_min_lux` | 300 lux | EN 12464-1 minimum for reading tasks |
| `light_max_lux` | 500 lux | EN 12464-1 maintained target |
| `motion_max_per_min` | 10 mov/min | Empirical baseline — adjust per room size |

> **VM / remote access note:** if you access the frontend from a different machine, set `REACT_APP_BACKEND_URL` to the host's LAN IP rather than `localhost`. The frontend JavaScript runs in the *browser*, so `localhost` resolves to the machine the browser is on, not the machine running the backend.

---

*University of Rwanda · Faculty of Engineering · 2026*
