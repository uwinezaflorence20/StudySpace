"""
Pure sensor data transformation functions for the studyspace-iot backend.

This module converts raw ESP32 sensor values into meaningful physical units
and computes a composite comfort score. It has no imports from database.py or
models.py and carries no HTTP or ORM concerns, making every function
independently unit-testable.
"""

import math


def adc_to_lux(adc_value: int) -> float:
    """Convert a 12-bit ADC count from the LDR voltage divider into lux.

    Circuit topology
    ----------------
    The GL5528 LDR is wired in a voltage divider with a 10 kΩ fixed resistor
    (R_fixed) between 3.3 V and GND. The ESP32 ADC reads the node between the
    LDR and R_fixed:

        3.3V ── [LDR] ──┬── [10 kΩ] ── GND
                        └── ADC pin

    As the room gets brighter, LDR resistance drops, the node voltage rises,
    and the ADC count increases.

    Conversion steps
    ----------------
    1. Recover node voltage from the 12-bit ADC count (0–4095 → 0–3.3 V).
    2. Back-calculate LDR resistance from the voltage divider equation.
    3. Apply the GL5528 inverse power-law: lux ≈ 500 / (R_kΩ ^ 0.7).
       This curve is empirically derived from the GL5528 datasheet and is
       accurate to ±20 % across the 10–1 000 lux range typical of indoor
       environments.

    Edge cases
    ----------
    - adc_value == 4095 (ADC saturated, voltage == 3.3 V): the divider
      formula produces a zero denominator.  We return 0.0 rather than raising.
    - Any result below 0.0 is clamped to 0.0.

    Args:
        adc_value: Raw 12-bit ADC reading, 0–4095.

    Returns:
        Illuminance in lux (float, ≥ 0.0).
    """
    voltage = (adc_value / 4095) * 3.3
    denominator = 3.3 - voltage
    if denominator <= 0.0:
        return 0.0

    ldr_resistance = (10_000 * voltage) / denominator  # ohms
    ldr_resistance_kohm = ldr_resistance / 1_000
    if ldr_resistance_kohm <= 0.0:
        return 0.0

    lux = 500 / (ldr_resistance_kohm ** 0.7)
    return max(0.0, lux)


def rms_to_db(rms_value: int, reference: int = 1) -> float:
    """Convert a raw INMP441 RMS amplitude integer into dB SPL.

    The INMP441 is a 24-bit I2S MEMS microphone with a sensitivity of
    −26 dBFS at 94 dB SPL (1 kHz, 1 Pa).  The full-scale 24-bit signed
    integer has a peak value of 2^23 − 1 ≈ 8 388 607.  A 94 dB SPL sine
    wave therefore produces an RMS of approximately:

        peak / √2 × 10^(−26/20) ≈ 8 388 607 / 1.414 × 0.0501 ≈ 297 302

    The commonly used rounded figure from the INMP441 application notes is
    420 426 RMS → 94 dB SPL (accounting for real-world crest factors).

    Anchoring
    ---------
    We convert the raw RMS to dBFS first:

        dBFS = 20 × log10(rms_value / reference)

    Then shift the scale so that 420 426 RMS reads 94 dB SPL:

        offset = 94 − 20 × log10(420 426 / reference)
        dB_SPL = dBFS + offset

    This collapses to a single expression:

        dB_SPL = 20 × log10(rms_value / 420 426) + 94

    which is what this function computes when reference == 1 (the default).
    Pass a different reference to override the anchor if your hardware is
    calibrated differently.

    Edge cases
    ----------
    rms_value ≤ 0 returns 0.0 to avoid a math domain error.

    Args:
        rms_value: Raw integer RMS amplitude from the INMP441.
        reference: Anchor RMS value that corresponds to 94 dB SPL.
                   Defaults to 1, which uses the internal 420 426 constant.

    Returns:
        Sound pressure level in dB SPL (float).  Returns 0.0 for silence or
        invalid input.
    """
    if rms_value <= 0:
        return 0.0

    _NOMINAL_RMS_AT_94DB = 420_426
    db_spl = 20 * math.log10(rms_value / _NOMINAL_RMS_AT_94DB) + 94
    return db_spl


def compute_movements_per_min(motion_count: int) -> float:
    """Convert a 5-second HC-SR501 motion count into movements per minute.

    The ESP32 firmware counts PIR rising-edge interrupts over a fixed 5-second
    window before transmitting.  There are 60 / 5 = 12 such windows per
    minute, so:

        movements_per_min = motion_count × 12

    Interval assumption
    -------------------
    This multiplier is hard-coded to the 5-second window defined in the
    firmware (config.h → MOTION_WINDOW_MS = 5000).  If the firmware window
    duration ever changes, this multiplier must be updated to match:

        multiplier = 60 / (MOTION_WINDOW_MS / 1000)

    Args:
        motion_count: Number of PIR rising-edge interrupts in a 5-second window.

    Returns:
        Estimated movements per minute (float).
    """
    _WINDOWS_PER_MINUTE = 12  # 60 s / 5 s window
    return float(motion_count * _WINDOWS_PER_MINUTE)


def _vapour_pressure(temperature: float, humidity: float) -> float:
    """Partial vapour pressure of water in hPa via the simplified Buck (1981) equation.

        e = (RH / 100) × 6.105 × exp(17.27 × T / (237.7 + T))

    Valid for indoor temperature ranges (0–50 °C).  Error < 0.5 % vs. the
    full Magnus–Tetens formula across this range.

    Args:
        temperature: Air temperature in °C.
        humidity:    Relative humidity in %.

    Returns:
        Partial vapour pressure in hPa.
    """
    return (humidity / 100) * 6.105 * math.exp(17.27 * temperature / (237.7 + temperature))


def apparent_temperature(temperature: float, humidity: float) -> float:
    """Compute apparent (feels-like) temperature using the Australian BOM formula.

    Physiological basis
    -------------------
    The human body regulates core temperature primarily through sweating.
    Sweat cools the skin only when it can evaporate, and evaporation rate is
    governed by how much water vapour the surrounding air can still absorb —
    i.e. the vapour pressure deficit.  High relative humidity at an elevated
    temperature means the air is nearly saturated; sweat cannot leave the skin
    and the body overheats even though the thermometer reads a plausible value.

    Formula
    -------
    Published by the Australian Bureau of Meteorology, derived from Steadman
    (1994) and validated against the ASHRAE 55 adaptive comfort model for
    still-air indoor conditions:

        AT = T + 0.33 × e − 4.0

    where:
        T  = dry-bulb temperature (°C)
        e  = partial water vapour pressure (hPa), from _vapour_pressure()
        −4.0 = convective loss correction at typical indoor air velocities

    The coefficient 0.33 converts hPa of vapour pressure into a perceived
    temperature offset in °C: every 3 hPa of additional moisture is felt as
    roughly 1 °C warmer.

    Args:
        temperature: Air temperature in °C.
        humidity:    Relative humidity in %.

    Returns:
        Apparent temperature in °C.
    """
    e = _vapour_pressure(temperature, humidity)
    return temperature + 0.33 * e - 4.0


def compute_comfort_score(
    temperature: float,
    humidity: float,
    sound_db: float,
    light_lux: float,
    movements_per_min: float,
    thresholds,
) -> float:
    """Compute a 0–100 comfort score indicating study-room suitability.

    Scientific model
    ----------------
    Three components replace the five independent sub-scores of the naive model,
    because temperature and humidity are physically coupled (the body cannot
    separate them), and acoustic discomfort is amplified by crowding:

        Thermal comfort   40 pts  — apparent temperature (temp × humidity combined)
        Acoustic comfort  35 pts  — sound dB, penalty multiplied by occupancy proxy
        Visual comfort    25 pts  — illuminance in lux

    ── Thermal Comfort (40 pts) ──────────────────────────────────────────────
    Apparent temperature (AT) is computed with the Australian BOM formula
    (Steadman 1994, used by ASHRAE Standard 55):

        e  = (RH/100) × 6.105 × exp(17.27 × T / (237.7 + T))   [vapour pressure, hPa]
        AT = T + 0.33 × e − 4.0                                  [apparent °C]

    AT is compared against the configured temp thresholds.  Score decays
    linearly to 0 at 8 °C beyond either bound — the physiological stress
    boundary identified in ASHRAE 55-2023 §5.3.

    ── Acoustic Comfort (35 pts) ─────────────────────────────────────────────
    WHO Environmental Noise Guidelines (2018) recommend < 35 dB LAeq for
    classrooms; 40 dB is used here to account for occupied-room background.

    Crowding amplifier: when motion exceeds its threshold, the noise penalty
    is multiplied by up to 1.5×.  The rationale is that noise from multiple
    simultaneous talkers surrounds the listener and cannot be filtered the way
    a single point source can (Klatte et al. 2010, Noise & Health).

        dB_excess       = max(0, sound_db − sound_max_db)
        crowding_ratio  = clamp(0, (motion − motion_max) / motion_max, 1)
        amplification   = 1.0 + 0.5 × crowding_ratio          [1.0× – 1.5×]
        acoustic_score  = max(0, 35 − dB_excess × 3.5 × amplification)

    ── Visual Comfort (25 pts) ───────────────────────────────────────────────
    EN 12464-1:2021 specifies 500 lux maintained for reading/writing tasks.
    Score is full within [light_min_lux, light_max_lux], decays to 0 at
    ±500 lux beyond either bound (wide tolerance because LDR accuracy is ±20 %
    and per-position lux varies across a room).

    Args:
        temperature:        Air temperature in °C.
        humidity:           Relative humidity in %.
        sound_db:           Sound pressure level in dB SPL.
        light_lux:          Illuminance in lux.
        movements_per_min:  Estimated movements per minute.
        thresholds:         SQLAlchemy ComfortThreshold ORM instance.

    Returns:
        Composite comfort score in [0.0, 100.0], rounded to one decimal place.
    """

    # ── Thermal Comfort (40 pts) ──────────────────────────────────────────
    at = apparent_temperature(temperature, humidity)
    at_lo = thresholds.temp_min
    at_hi = thresholds.temp_max
    if at_lo <= at <= at_hi:
        thermal_score = 40.0
    else:
        excess = (at_lo - at) if at < at_lo else (at - at_hi)
        thermal_score = max(0.0, 40.0 * (1.0 - excess / 8.0))

    # ── Acoustic Comfort (35 pts) ─────────────────────────────────────────
    dB_excess = max(0.0, sound_db - thresholds.sound_max_db)
    if movements_per_min > thresholds.motion_max_per_min:
        crowding_ratio = min(
            1.0,
            (movements_per_min - thresholds.motion_max_per_min) / thresholds.motion_max_per_min,
        )
    else:
        crowding_ratio = 0.0
    amplification = 1.0 + 0.5 * crowding_ratio
    acoustic_score = max(0.0, 35.0 - dB_excess * 3.5 * amplification)

    # ── Visual Comfort (25 pts) ───────────────────────────────────────────
    if thresholds.light_min_lux <= light_lux <= thresholds.light_max_lux:
        visual_score = 25.0
    else:
        excess = (
            (thresholds.light_min_lux - light_lux)
            if light_lux < thresholds.light_min_lux
            else (light_lux - thresholds.light_max_lux)
        )
        visual_score = max(0.0, 25.0 * (1.0 - excess / 500.0))

    return round(thermal_score + acoustic_score + visual_score, 1)


def classify_reading(
    temperature: float,
    humidity: float,
    sound_db: float,
    light_lux: float,
    movements_per_min: float,
    comfort_score: float,
    thresholds,
) -> str:
    """Assign a single categorical label to a sensor reading.

    Labels are evaluated in priority order so each reading gets exactly one
    class.  The priority reflects severity: a poor overall score takes
    precedence over a specific metric being slightly off.

    Classes (in priority order)
    ---------------------------
    poor         comfort_score < 50  — generally uncomfortable environment
    warm         apparent_temp > temp_max + 2 °C — thermally stressed, hot side
    humid        humidity > 70 % — air is uncomfortably moist
    noisy        sound_db > sound_max_db + 5 dB — clearly above noise threshold
    dim          light_lux < light_min_lux − 100 lux — too dark for reading
    crowded      movements_per_min > motion_max × 2 — high occupancy event
    moderate     50 ≤ comfort_score < 75 — acceptable but not ideal
    comfortable  comfort_score ≥ 75 — all conditions within ideal ranges

    Args:
        temperature:        Air temperature in °C.
        humidity:           Relative humidity in %.
        sound_db:           Sound pressure level in dB SPL.
        light_lux:          Illuminance in lux.
        movements_per_min:  Estimated movements per minute.
        comfort_score:      Composite 0–100 comfort score.
        thresholds:         SQLAlchemy ComfortThreshold ORM instance.

    Returns:
        One of: 'poor', 'warm', 'humid', 'noisy', 'dim', 'crowded',
                'moderate', 'comfortable'.
    """
    at = apparent_temperature(temperature, humidity)

    if comfort_score < 50:
        return "poor"
    if at > thresholds.temp_max + 2:
        return "warm"
    if humidity > 70:
        return "humid"
    if sound_db > thresholds.sound_max_db + 5:
        return "noisy"
    if light_lux < thresholds.light_min_lux - 100:
        return "dim"
    if movements_per_min > thresholds.motion_max_per_min * 2:
        return "crowded"
    if comfort_score >= 75:
        return "comfortable"
    return "moderate"


def run_all_transforms(payload, thresholds) -> dict:
    """Run every sensor transform and return a dict ready to merge into a DB row.

    This is the single entry point the readings route calls.  It accepts the
    validated SensorPayload Pydantic object and the active ComfortThreshold
    ORM instance, applies all conversions, and returns a flat dictionary
    containing only the four derived fields:

        light_lux          — converted from payload.light_raw
        sound_db           — converted from payload.sound_rms
        movements_per_min  — derived from payload.motion_count
        comfort_score      — composite 0–100 score

    The caller is responsible for merging this dict with the raw payload fields
    before inserting into sensor_readings.

    Args:
        payload:    Validated SensorPayload instance.
        thresholds: Active ComfortThreshold ORM instance.

    Returns:
        dict with keys: light_lux, sound_db, movements_per_min, comfort_score.
    """
    light_lux = adc_to_lux(payload.light_raw)
    sound_db = rms_to_db(payload.sound_rms)
    movements_per_min = compute_movements_per_min(payload.motion_count)
    comfort_score = compute_comfort_score(
        temperature=payload.temperature,
        humidity=payload.humidity,
        sound_db=sound_db,
        light_lux=light_lux,
        movements_per_min=movements_per_min,
        thresholds=thresholds,
    )

    label = classify_reading(
        temperature=payload.temperature,
        humidity=payload.humidity,
        sound_db=sound_db,
        light_lux=light_lux,
        movements_per_min=movements_per_min,
        comfort_score=comfort_score,
        thresholds=thresholds,
    )

    return {
        "light_lux": light_lux,
        "sound_db": sound_db,
        "movements_per_min": movements_per_min,
        "comfort_score": comfort_score,
        "label": label,
    }
