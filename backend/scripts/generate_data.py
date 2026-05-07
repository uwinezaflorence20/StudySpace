# Usage
# ─────
# Make sure the backend is running first:
#   uvicorn app.main:app --reload   (from backend/ directory)
#
# Live mode — posts one reading per room every 5 seconds:
#   python scripts/generate_data.py
#
# Bulk mode — fills the database with N historical records as fast as the
# backend can accept them (no sleep delay, simulated timestamps):
#   python scripts/generate_data.py --bulk 100000
#
# To simulate multiple rooms, register them in the dashboard first,
# then add their slugs to the ROOMS list below.
#
# Stop with Ctrl+C.

"""
Standalone data source for studyspace-iot development.

Simulates sensor readings calibrated to real-world indoor conditions observed
in Kigali, Rwanda (elevation ~1 500 m).  Environmental baselines are derived
from:

  • Kigali climate data — WeatherSpark / Climates to Travel
  • UR occupancy patterns — Occuspace higher-education benchmarks
  • ASHRAE 55-2023 tropical comfort norms for naturally ventilated buildings
  • EN 12464-1:2021 classroom lighting standards

Two operating modes
-------------------
Live mode (default):
    Posts one reading per SEND_INTERVAL seconds using the current wall-clock
    timestamp.  Values drift continuously; use this while the dashboard is
    open to watch live updates.

Bulk mode (--bulk N):
    Posts N readings per room without sleeping.  Timestamps are simulated,
    advancing SEND_INTERVAL seconds per tick starting from N×SEND_INTERVAL
    seconds in the past.  The same /api/ingest endpoint is used, so every
    record passes through the full transform and scoring pipeline exactly as a
    real sensor would.  Use this to build up a large historical dataset.
"""

import argparse
import math
import signal
import sys
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import requests

# ─── Configuration ────────────────────────────────────────────────────────────
BACKEND_URL   = "http://localhost:8000/api/ingest"
SEND_INTERVAL = 5   # seconds represented by each tick

ROOMS = [
    "muhabura_p003",
]

# ─── Kigali / UR Environmental Baselines ──────────────────────────────────────
#
# Temperature
#   Kigali sits at ~1 500 m.  Outdoor year-round average is 21.8 °C with a
#   range of 16–27 °C.  Well-ventilated UR study rooms track the outdoor
#   temperature closely; air-conditioned spaces are held near 25 °C.
#   Source: WeatherSpark Kigali annual averages; ASHRAE 55 tropical norms.
_TEMP_BASE = 23.5   # °C — typical air-conditioned study room

# Seasonal temperature offsets (°C added to base)
_TEMP_SEASON = {
    "long_rainy":  -0.4,   # Mar–May  — cooler, overcast
    "main_dry":    +0.6,   # Jun–Aug  — driest, warmest
    "short_rainy": -0.3,   # Oct–Dec  — transitional
    "short_dry":   +0.2,   # Dec–Feb  — coolest nights, mild days
}

# Humidity
#   Outdoor annual average RH in Kigali: 71 %.  Indoor levels depend on HVAC:
#     Main dry season  (Jun–Aug): 47–60 % RH
#     Rainy seasons (Mar–May, Oct–Dec): 60–78 % RH
#   Source: Climates to Travel; ASHRAE humidity control guidelines.
_HUMID_BASE = 55.0  # % RH — baseline for a ventilated room

_HUMID_SEASON = {
    "long_rainy":  +12.0,   # heavy rain, high moisture infiltration
    "main_dry":    -10.0,   # driest period
    "short_rainy": +8.0,    # humidity climbing
    "short_dry":   -5.0,    # relatively dry
}

# Light
#   EN 12464-1:2021 specifies 500 lux for reading/writing tasks.
#   UR study rooms achieve 300–500 lux under artificial ceiling lighting.
#   During rainy season with reduced daylight, values can drop to 250–350 lux
#   unless supplemental lighting compensates.
#   ADC mapping (GL5528, 10 kΩ divider, 3.3 V):
#     ADC ~420 → ~465 lux   ADC ~530 → ~380 lux   ADC ~650 → ~300 lux
_LIGHT_ADC_BASE = 530   # centred on ~380 lux — comfortable study level

# Sound
#   WHO Environmental Noise Guidelines (2018): < 35 dB LAeq for classrooms.
#   UR study rooms with low occupancy: 32–42 dB.
#   Active study/group areas: 45–58 dB.
#   INMP441 RMS reference: 420 426 counts → 94 dB SPL
#     32 dB → rms ≈     420   (near-silent, well below 40 dB threshold)
#     40 dB → rms ≈   1 330   (right at threshold)
#     50 dB → rms ≈   4 205   (group conversation, above threshold)
#     58 dB → rms ≈  13 300   (loud, busy room)

# ─── Periodic drift constants (ticks) ─────────────────────────────────────────
_TEMP_PERIOD   = int(12 * 60 / SEND_INTERVAL)   # 12-min HVAC cycle  → 144 ticks
_HUMID_PERIOD  = int(20 * 60 / SEND_INTERVAL)   # 20-min humidity drift → 240 ticks
_LIGHT_PERIOD  = int( 8 * 60 / SEND_INTERVAL)   #  8-min lighting flicker → 96 ticks


# ─── Season and time-of-day helpers ───────────────────────────────────────────

def _season(dt: datetime) -> str:
    m = dt.month
    if m in (3, 4, 5):      return "long_rainy"
    if m in (6, 7, 8):      return "main_dry"
    if m in (10, 11, 12):   return "short_rainy"
    return "short_dry"


def _occupancy_factor(dt: datetime) -> float:
    """Return 0–1 occupancy estimate for the given CAT datetime.

    Based on UR class schedules and Occuspace higher-education benchmarks:
      • Peak 11:00–16:00 weekdays (lectures + self-study after class)
      • Secondary 17:00–20:00 (evening study sessions)
      • Very low outside those windows; weekends at ~15 % of weekday peak
    """
    if dt.weekday() >= 5:   # Saturday / Sunday
        return 0.15
    h = dt.hour
    if   11 <= h < 16: return 1.00
    elif 17 <= h < 20: return 0.70
    elif  8 <= h < 11: return 0.55
    elif 20 <= h < 22: return 0.35
    elif  7 <= h <  8: return 0.20
    else:              return 0.05   # night / very early morning


def _diurnal_temp_offset(dt: datetime) -> float:
    """Small sinusoidal temperature offset peaking at 14:00 CAT (±0.8 °C)."""
    hour_frac = dt.hour + dt.minute / 60
    return 0.8 * math.sin(math.pi * (hour_frac - 6) / 12)


# ─── Core reading generator ────────────────────────────────────────────────────

def _generate(room_index: int, tick: int, sim_time: datetime) -> dict:
    """Generate one plausible sensor reading for a Kigali study room.

    Args:
        room_index: Phase offset so multiple rooms drift out of sync.
        tick:       Monotonic counter used for periodic drift.
        sim_time:   The UTC datetime this reading represents.

    Returns:
        Dict matching the SensorPayload schema expected by /api/ingest.
    """
    # Phase offset: rooms separated by 120° so they never all peak together
    phase = room_index * (2 * np.pi / 3)

    # Convert to CAT (UTC+2) for occupancy and diurnal calculations
    cat_time = sim_time.astimezone(timezone(timedelta(hours=2)))
    season   = _season(cat_time)
    occ      = _occupancy_factor(cat_time)

    # ── Anomaly injection (~3.5 % of readings) ────────────────────────────────
    # Rare events that push one sensor well outside its normal range.
    # Each type is independent; at most one fires per reading.
    # These produce anomaly records in the DB for training and dashboard display.
    #
    # INMP441 RMS anchors: rms = 420426 × 10^((dB-94)/20)
    #   65 dB → rms ≈  53 000   (very loud event)
    #   72 dB → rms ≈ 168 000   (near-threshold of the 400 000 clamp)
    #
    # GL5528 ADC anchors (10 kΩ divider, LDR on GND side):
    #   ADC ~2000 → R_ldr ~9.5 kΩ → lux ≈  85  (lamp failure / blackout)
    #   ADC ~ 160 → R_ldr ~0.41 kΩ → lux ≈ 900  (direct sunlight flooding)
    anomaly_roll = np.random.random()

    if anomaly_roll < 0.007:
        # HVAC failure / heat source — apparent temp will cross temp_max + 5
        temp = float(np.random.uniform(30.0, 33.0))
        humidity = float(np.clip(
            _HUMID_BASE + _HUMID_SEASON[season] + np.random.normal(0, 1.5),
            30.0, 80.0,
        ))
        motion_count = int(np.random.randint(0, 3))
        light_raw    = int(np.clip(
            _LIGHT_ADC_BASE + 100 * np.sin(2 * np.pi * tick / _LIGHT_PERIOD + phase)
            + np.random.normal(0, 18), 0, 4095,
        ))
        sound_rms    = int(np.clip(np.random.normal(800, 200), 0, 400_000))

    elif anomaly_roll < 0.014:
        # Window open in heavy rain — humidity surge
        temp     = float(np.clip(
            _TEMP_BASE + _TEMP_SEASON[season] + _diurnal_temp_offset(cat_time)
            + np.random.normal(0, 0.3), 19.0, 29.0,
        ))
        humidity = float(np.random.uniform(79.0, 88.0))
        motion_count = int(np.random.randint(0, 3))
        light_raw    = int(np.clip(
            _LIGHT_ADC_BASE + np.random.normal(0, 25), 0, 4095,
        ))
        sound_rms    = int(np.clip(np.random.normal(800, 200), 0, 400_000))

    elif anomaly_roll < 0.021:
        # Acoustic spike — sudden loud event (65–72 dB)
        temp     = float(np.clip(
            _TEMP_BASE + _TEMP_SEASON[season] + _diurnal_temp_offset(cat_time)
            + np.random.normal(0, 0.3), 19.0, 29.0,
        ))
        humidity = float(np.clip(
            _HUMID_BASE + _HUMID_SEASON[season] + np.random.normal(0, 1.5),
            30.0, 80.0,
        ))
        motion_count = int(np.random.randint(3, 8))
        light_raw    = int(np.clip(
            _LIGHT_ADC_BASE + np.random.normal(0, 25), 0, 4095,
        ))
        sound_rms    = int(np.clip(np.random.normal(110_000, 30_000), 0, 400_000))

    elif anomaly_roll < 0.028:
        # Lamp failure or direct sunlight flooding
        temp     = float(np.clip(
            _TEMP_BASE + _TEMP_SEASON[season] + _diurnal_temp_offset(cat_time)
            + np.random.normal(0, 0.3), 19.0, 29.0,
        ))
        humidity = float(np.clip(
            _HUMID_BASE + _HUMID_SEASON[season] + np.random.normal(0, 1.5),
            30.0, 80.0,
        ))
        motion_count = int(np.random.randint(0, 3))
        # 50/50: lamp failure (dim, ADC ~2000) or sunlight flooding (bright, ADC ~160)
        if np.random.random() < 0.5:
            light_raw = int(np.clip(np.random.normal(2000, 150), 1500, 2500))   # ~85 lux
        else:
            light_raw = int(np.clip(np.random.normal(160, 30), 80, 280))        # ~900 lux
        sound_rms = int(np.clip(np.random.normal(800, 200), 0, 400_000))

    elif anomaly_roll < 0.035:
        # Motion surge — unusual crowd event
        temp     = float(np.clip(
            _TEMP_BASE + _TEMP_SEASON[season] + _diurnal_temp_offset(cat_time)
            + np.random.normal(0, 0.3), 19.0, 29.0,
        ))
        humidity = float(np.clip(
            _HUMID_BASE + _HUMID_SEASON[season] + np.random.normal(0, 1.5),
            30.0, 80.0,
        ))
        motion_count = int(np.random.randint(11, 18))  # → 132–216 mov/min (well above 3× threshold)
        light_raw    = int(np.clip(
            _LIGHT_ADC_BASE + np.random.normal(0, 25), 0, 4095,
        ))
        sound_rms    = int(np.clip(np.random.normal(8_000, 2_000), 0, 400_000))

    else:
        # ── Normal reading (96.5 % of the time) ──────────────────────────────

        # Temperature: base + seasonal + diurnal + HVAC drift + sensor noise
        temp = (
            _TEMP_BASE
            + _TEMP_SEASON[season]
            + _diurnal_temp_offset(cat_time)
            + 1.5 * np.sin(2 * np.pi * tick / _TEMP_PERIOD + phase)
            + np.random.normal(0, 0.2)
        )
        temp = float(np.clip(temp, 19.0, 29.0))

        # Humidity: higher in rainy seasons from ventilation infiltration
        humidity = (
            _HUMID_BASE
            + _HUMID_SEASON[season]
            + 6.0 * np.sin(2 * np.pi * tick / _HUMID_PERIOD + phase)
            + np.random.normal(0, 1.0)
        )
        humidity = float(np.clip(humidity, 30.0, 78.0))

        # Motion: probabilities scale with UR occupancy timetable
        p_silent = max(0.05, 0.95 - occ * 0.70)
        p_burst  = min(0.20, occ * 0.12)
        p_light  = 1.0 - p_silent - p_burst
        regime = np.random.choice(["silent", "light", "burst"],
                                   p=[p_silent, p_light, p_burst])
        if regime == "silent":
            motion_count = 0
        elif regime == "light":
            motion_count = int(np.random.randint(1, 4))
        else:
            motion_count = int(np.random.randint(5, 10))

        # Light: base ~380 lux; rainy season and night shift ADC upward (dimmer)
        season_adc_offset = 60 if season in ("long_rainy", "short_rainy") else -20
        night_adc_offset  = 200 if cat_time.hour < 7 or cat_time.hour >= 22 else 0
        light_raw = (
            _LIGHT_ADC_BASE
            + season_adc_offset
            + night_adc_offset
            + 100 * np.sin(2 * np.pi * tick / _LIGHT_PERIOD + phase)
            + np.random.normal(0, 18)
        )
        light_raw = int(np.clip(light_raw, 0, 4095))

        # Sound: regime probabilities scale with occupancy
        # INMP441 anchors: 33 dB → 600 RMS · 46–50 dB → 3 500 RMS · 55–58 dB → 12 000 RMS
        p_quiet    = max(0.20, 0.90 - occ * 0.65)
        p_loud     = min(0.12, occ * 0.08)
        p_moderate = 1.0 - p_quiet - p_loud
        sound_regime = np.random.choice(["quiet", "moderate", "loud"],
                                         p=[p_quiet, p_moderate, p_loud])
        if sound_regime == "quiet":
            sound_rms = int(np.random.normal(600, 150))
        elif sound_regime == "moderate":
            sound_rms = int(np.random.normal(3_500, 700))
        else:
            sound_rms = int(np.random.normal(12_000, 2_500))
        sound_rms = int(np.clip(sound_rms, 0, 400_000))

    return {
        "room_id":      None,
        "timestamp":    sim_time.isoformat().replace("+00:00", "Z"),
        "temperature":  round(temp, 2),
        "humidity":     round(humidity, 2),
        "motion_count": motion_count,
        "light_raw":    light_raw,
        "sound_rms":    sound_rms,
    }


# ─── Post helper ──────────────────────────────────────────────────────────────

def _post(room_id: str, room_index: int, tick: int, sim_time: datetime,
          verbose: bool = True) -> bool:
    payload = _generate(room_index, tick, sim_time)
    payload["room_id"] = room_id

    try:
        response = requests.post(BACKEND_URL, json=payload, timeout=10)
        if response.status_code == 201 and verbose:
            d = response.json()
            cat_str = sim_time.astimezone(
                timezone(timedelta(hours=2))
            ).strftime("%H:%M:%S")
            print(
                f"[{cat_str}] {room_id:<20} →  {response.status_code}"
                f"  temp={d['temperature']:.1f}°C"
                f"  hum={d['humidity']:.1f}%"
                f"  motion={d['motion_count']}"
                f"  rms={d['sound_rms']}"
            )
        elif response.status_code != 201 and verbose:
            print(f"  [{room_id}] {response.status_code} — {response.text.strip()}")
        return response.status_code == 201
    except requests.exceptions.ConnectionError:
        print("[WARN] Cannot reach backend.")
        return False
    except requests.exceptions.Timeout:
        print(f"[WARN] Timeout — {room_id}")
        return False
    except Exception as exc:
        print(f"[ERROR] {room_id}: {exc}")
        return False


# ─── Entry Point ──────────────────────────────────────────────────────────────

def _parse_args():
    parser = argparse.ArgumentParser(description="studyspace-iot data source")
    parser.add_argument(
        "--bulk", type=int, metavar="N", default=0,
        help="Post N readings per room without sleeping (simulated timestamps).",
    )
    return parser.parse_args()


def handle_exit(sig, frame):
    print("\n[INFO] Stopped.")
    sys.exit(0)


signal.signal(signal.SIGINT, handle_exit)

args = _parse_args()

print("[INFO] StudySpace IoT — Data Source")
print(f"[INFO] Backend : {BACKEND_URL}")
print(f"[INFO] Rooms   : {', '.join(ROOMS)}")

if args.bulk:
    # ── Bulk mode ──────────────────────────────────────────────────────────
    # Simulate N ticks starting from N×SEND_INTERVAL seconds in the past so
    # the last record's timestamp lands at approximately now.
    total_ticks = args.bulk
    start_time  = datetime.now(timezone.utc) - timedelta(seconds=total_ticks * SEND_INTERVAL)

    print(f"[INFO] Mode    : bulk  ({total_ticks:,} ticks × {len(ROOMS)} rooms"
          f" = {total_ticks * len(ROOMS):,} records)")
    print(f"[INFO] Simulated window : {start_time.strftime('%Y-%m-%d %H:%M')} UTC"
          f" → now\n")

    posted = 0
    failed = 0
    for tick in range(total_ticks):
        sim_time = start_time + timedelta(seconds=tick * SEND_INTERVAL)
        for room_index, room_id in enumerate(ROOMS):
            ok = _post(room_id, room_index, tick, sim_time, verbose=False)
            if ok:
                posted += 1
            else:
                failed += 1

        # Progress every 1 000 ticks
        if (tick + 1) % 1_000 == 0:
            pct = (tick + 1) / total_ticks * 100
            print(f"  {tick + 1:>7,} / {total_ticks:,} ticks  ({pct:.1f} %)   "
                  f"posted={posted:,}  failed={failed:,}")

    print(f"\n[INFO] Done — {posted:,} records posted, {failed:,} failed.")

else:
    # ── Live mode ──────────────────────────────────────────────────────────
    print(f"[INFO] Mode    : live  (every {SEND_INTERVAL}s — Ctrl+C to stop)\n")
    tick = 0
    while True:
        now = datetime.now(timezone.utc)
        for room_index, room_id in enumerate(ROOMS):
            _post(room_id, room_index, tick, now, verbose=True)
        tick += 1
        time.sleep(SEND_INTERVAL)
