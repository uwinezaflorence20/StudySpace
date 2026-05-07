#ifndef CONFIG_H
#define CONFIG_H

// ─── Network ─────────────────────────────────────────────────────────────────
// Replace with your actual WiFi credentials before flashing
#define WIFI_SSID       "your_wifi_name"
#define WIFI_PASSWORD   "your_wifi_password"

// ─── Backend ─────────────────────────────────────────────────────────────────
// Copy this value from the terminal output when you run docker compose up.
// Format: http://<local-ip>:8000/api/ingest
// Use the LAN IP — localhost or 127.0.0.1 will not work from the ESP32
#define BACKEND_URL     "http://192.168.x.x:8000/api/ingest"

// ─── Room Identity ───────────────────────────────────────────────────────────
// Must exactly match the room slug registered in the Settings page.
// Example: "library_floor_2"  not  "Library Floor 2"
// The backend returns 404 for every payload from an unregistered room_id
#define ROOM_ID         "your_room_slug"

// ─── Timing ──────────────────────────────────────────────────────────────────
// How often to read sensors and POST to the backend (milliseconds).
// DHT22 datasheet requires a minimum of 2000 ms between reads.
// Do not set below 2000 — readings will return NaN if polled too quickly.
// At 5000 ms the backend receives 12 readings per minute, which is what
// the transforms.compute_movements_per_min() multiplier is calibrated for.
// If you change this value you must also update _WINDOWS_PER_MINUTE in
// backend/app/transforms.py to match (60000 / SEND_INTERVAL).
#define SEND_INTERVAL   5000

// ─── Pin Definitions ─────────────────────────────────────────────────────────
#define DHT_PIN         4       // DHT22 data pin (single-wire, needs 10kΩ pull-up to 3.3V)
#define PIR_PIN         27      // HC-SR501 digital output (3.3V compatible)
#define LDR_PIN         34      // LDR voltage divider output — ADC1 channel 6
                                // GPIO34 is input-only; never use as output

// I2S pins for INMP441 microphone
#define I2S_SCK_PIN     14      // Serial clock (BCLK)
#define I2S_WS_PIN      15      // Word select / left-right clock (LRCL)
#define I2S_SD_PIN      32      // Serial data out from mic (DOUT)
                                // Tie the INMP441 L/R pin to GND for left channel

// ─── Audio Sampling ──────────────────────────────────────────────────────────
// Number of I2S samples to collect per reading window.
// At 44100 Hz, 1024 samples ≈ 23 ms of audio — enough to capture a
// representative RMS value without blocking the loop for too long.
// Increasing this improves accuracy but lengthens the blocking i2s_read call.
#define I2S_SAMPLE_COUNT  1024
#define I2S_SAMPLE_RATE   44100

// ─── NTP / Time ──────────────────────────────────────────────────────────────
// CAT (Central Africa Time) is UTC+2 with no daylight saving time.
// GMT offset is 2 × 3600 = 7200 seconds. Daylight offset is always 0.
// configTime() uses these values to set the ESP32's internal RTC after NTP sync.
// Timestamps sent to the backend include the explicit "+02:00" offset so the
// backend's Pydantic parser interprets them correctly and PostgreSQL stores
// them normalised to UTC (standard practice for timezone-aware columns).
#define CAT_OFFSET_SEC       7200   // UTC+2, no DST

// Maximum milliseconds to wait for NTP sync on each timestamp call.
// If NTP does not respond within this window the fallback "1970-..." string
// is returned so the backend still receives a structurally valid payload.
#define NTP_SYNC_TIMEOUT_MS  5000

#endif // CONFIG_H
