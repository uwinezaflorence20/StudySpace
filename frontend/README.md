# StudySpace IoT — Frontend

A React dashboard that polls the FastAPI backend every 3 seconds to display live environmental sensor readings from ESP32-monitored study rooms. The dashboard shows per-room comfort scores, rolling time-series charts, historical summaries, anomaly logs, and a settings panel for managing rooms and adjusting comfort thresholds.

---

## Table of Contents

- [Pages](#pages)
- [Running with Docker](#running-with-docker)
- [Running Locally Without Docker](#running-locally-without-docker)
- [Environment Variables](#environment-variables)
- [How Live Updates Work](#how-live-updates-work)
- [Adding a Room](#adding-a-room)
- [Comfort Score Interpretation](#comfort-score-interpretation)
- [Adjusting Thresholds](#adjusting-thresholds)
- [Tech Stack](#tech-stack)

---

## Pages

| Path | Page | What it shows |
|---|---|---|
| `/` | Room List | All registered rooms as cards — each card shows the room name, slug, and current comfort score fetched live. A pulsing green dot indicates live data. |
| `/rooms/:room_id` | Room Detail | A multi-line chart of the last 5 minutes of temperature, humidity, sound, and light readings. Four metric cards (clickable) showing the current value with avg/min/max from the last 24 hours. A comfort score bar at the top. |
| `/rooms/:room_id/metrics/:metric` | Metric Detail | A single-metric chart for the chosen metric with a 5-minute rolling window. Current value displayed prominently with a color indicator (green / yellow / red) based on how close it is to the configured threshold. |
| `/anomalies` | Anomalies | A table of all flagged anomaly events across all rooms. Filterable by room, date range, and limit. Each row links back to the relevant room. |
| `/settings` | Settings | Two sections: the eight comfort threshold fields (editable, saves on demand) and room management (add a room, delete a room with confirmation). |

---

## Running with Docker

The frontend starts automatically as part of `docker compose up` from the monorepo root. No separate steps are required.

```bash
# From the root of the monorepo
cp .env.example .env
docker compose up --build
```

The dashboard is available at **http://localhost:3000** once the container is running. The frontend container depends on the backend container being started (`service_started` condition), so it will not launch until the backend is up.

---

## Running Locally Without Docker

Use this during development for faster iteration — React hot reload works without waiting for a Docker rebuild.

**Prerequisites:** Node.js 18+, and the backend running separately (either via Docker or locally with `uvicorn`).

```bash
# From the frontend/ directory
cp .env.example .env
# Edit .env — set REACT_APP_BACKEND_URL=http://localhost:8000

npm install
npm start
```

The dashboard will be available at **http://localhost:3000**. The `proxy` field in `package.json` is set to `http://backend:8000` for Docker use; when running locally, the `REACT_APP_BACKEND_URL` environment variable in `.env` takes precedence via the Axios base URL.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `REACT_APP_BACKEND_URL` | Base URL of the FastAPI backend — used by the Axios client for all API calls | `http://localhost:8000` |

Copy `.env.example` to `.env` and set this value before running `npm start`. The `REACT_APP_` prefix is required by Create React App — variables without it are not injected into the browser bundle.

---

## How Live Updates Work

The dashboard uses **polling**, not WebSockets. On the Room Detail and Metric Detail pages, a `setInterval` runs every 3 seconds and calls `GET /api/rooms/:room_id/latest` to fetch the most recent sensor reading. Each new reading is appended to a rolling array capped at 60 entries, giving a 5-minute window (60 readings × 5-second ESP32 send interval).

```
[oldest] ←─── 60 readings ───→ [latest]
```

When a new reading arrives it is added to the right end of the array. If the array length exceeds 60, the leftmost entry is dropped. The Recharts line chart re-renders with the updated array — because `isAnimationActive={false}` is set on all chart lines, there is no re-animation on every poll cycle.

Duplicate readings are suppressed client-side: if the latest reading's `id` matches the last entry in the array (meaning no new data arrived since the last poll), the array is not modified.

No page refresh is needed. Navigating away from a page clears all intervals via `useEffect` cleanup functions, preventing memory leaks from stale subscriptions.

---

## Adding a Room

**Always register the room in the dashboard before flashing the ESP32.** The backend validates `room_id` on every ingest request and returns `404` for any payload from an unregistered room.

1. Open **Settings** at `http://localhost:3000/settings`
2. Click **Add Room**
3. Type the room's display name in the modal — for example `Library Floor 2`
4. The **Room ID** field below it updates automatically as you type, showing the auto-generated slug: `library_floor_2`
5. Click **Create Room**
6. Copy the Room ID slug exactly as shown — this is what the ESP32 must send in every payload
7. Open `firmware/main/config.h` and set:
   ```cpp
   #define ROOM_ID "library_floor_2"
   ```
8. Flash the ESP32 — it will start posting to `/api/ingest` immediately and the room card will appear on the dashboard within one polling cycle

The slug is generated by converting the name to lowercase, replacing spaces with underscores, and removing all characters that are not letters, digits, or underscores. The same logic runs in both the frontend modal and the backend route so the stored ID is always consistent.

---

## Comfort Score Interpretation

The comfort score is a 0–100 float computed server-side on every ingested reading. It represents how suitable the room is for studying based on five equally-weighted environmental metrics: temperature, humidity, sound level, light level, and motion.

| Score | Label | Meaning |
|---|---|---|
| 75–100 | Good for studying | All five metrics are within their configured ideal ranges |
| 50–74 | Moderate conditions | One or more metrics are outside the ideal range but not severely so |
| 0–49 | Poor conditions | One or more metrics are significantly outside the ideal range |

On the Room Detail page the score is shown as a large number with a proportional horizontal bar. On the Room List page each room card shows its own live score fetched individually on mount.

---

## Adjusting Thresholds

Go to **Settings → Comfort Thresholds**. The form pre-fills with the current values fetched from the backend. Edit any field and click **Save Thresholds**.

Changes are applied immediately — the next reading ingested by the backend will use the new thresholds for both comfort scoring and anomaly detection. No server restart is required. All rooms share the same threshold configuration.

The eight configurable thresholds and their defaults:

| Field | Default | Unit | Effect |
|---|---|---|---|
| Temp Min | 18.0 | °C | Below this, temperature sub-score starts dropping |
| Temp Max | 26.0 | °C | Above this, temperature sub-score starts dropping |
| Humidity Min | 30.0 | % RH | Below this, humidity sub-score starts dropping |
| Humidity Max | 60.0 | % RH | Above this, humidity sub-score starts dropping |
| Sound Max | 40.0 | dB SPL | Above this, sound sub-score drops by 2 pts/dB |
| Light Min | 300.0 | lux | Below this, light sub-score starts dropping |
| Light Max | 500.0 | lux | Above this, light sub-score starts dropping |
| Motion Max | 10.0 | mov/min | Above this, motion sub-score drops by 2 pts per mov/min |

---

## Tech Stack

| Library | Version | Purpose |
|---|---|---|
| React | 18.2 | Component model, hooks, state management |
| React Router v6 | 6.22 | Client-side routing with URL params |
| Recharts | 2.12 | Responsive SVG time-series charts |
| Axios | 1.6 | HTTP client with base URL and typed responses |
| react-scripts | 5.0.1 | Build toolchain (Create React App) |

No component library is used — all styling is plain CSS via `<style>` blocks scoped to each component, using the CSS custom properties defined in `index.css`.
