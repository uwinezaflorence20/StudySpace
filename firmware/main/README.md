# StudySpace IoT — Firmware

Arduino-flavored C++ firmware for the ESP32 that reads four environmental sensors every 5 seconds and POSTs the raw values to the StudySpace IoT backend over WiFi. The firmware does no data transformation — it sends raw ADC counts, RMS integers, and interrupt counts exactly as the hardware produces them. All unit conversion and scoring happens server-side.

---

## Table of Contents

- [Hardware Required](#hardware-required)
- [Wiring](#wiring)
- [Arduino IDE Setup](#arduino-ide-setup)
- [Configuration Before Flashing](#configuration-before-flashing)
- [Flashing](#flashing)
- [Serial Monitor Output](#serial-monitor-output)
- [Troubleshooting](#troubleshooting)
- [Adding This Room to a New ESP32](#adding-this-room-to-a-new-esp32)

---

## Hardware Required

| Component | Quantity | Purpose |
|---|---|---|
| ESP32 DevKit v1 | 1 | Microcontroller — WiFi, ADC, I2S, GPIO |
| DHT22 (AM2302) | 1 | Temperature and humidity sensor |
| HC-SR501 PIR | 1 | Passive infrared motion detector |
| LDR GL5528 | 1 | Light-dependent resistor for ambient light |
| INMP441 | 1 | MEMS I2S microphone for sound level |
| 10 kΩ resistor | 1 | LDR voltage divider fixed resistor |
| 10 kΩ resistor | 1 | DHT22 data line pull-up to 3.3 V |
| Breadboard + jumper wires | — | Connections |
| USB cable (Micro-USB) | 1 | Power and flashing |

---

## Wiring

### DHT22 — Temperature & Humidity

The DHT22 has four pins. Pin 2 is the data line and requires a 10 kΩ pull-up resistor between it and VCC.

| DHT22 Pin | Connects to |
|---|---|
| Pin 1 — VCC | ESP32 3.3 V |
| Pin 2 — DATA | ESP32 GPIO 4 **and** one leg of 10 kΩ resistor |
| Pin 3 — NC | Not connected |
| Pin 4 — GND | ESP32 GND |
| Other leg of 10 kΩ resistor | ESP32 3.3 V |

> Without the pull-up resistor, the data line floats and the DHT22 returns `nan` on every read.

---

### HC-SR501 — PIR Motion Sensor

The HC-SR501 operates at 5 V but its output pin is 3.3 V compatible when connected to an ESP32.

| HC-SR501 Pin | Connects to |
|---|---|
| VCC | ESP32 5 V (Vin) |
| OUT | ESP32 GPIO 27 |
| GND | ESP32 GND |

> The two potentiometers on the HC-SR501 control sensitivity (left) and hold time (right). Turn both to their minimum position for the fastest response and lowest hold time suitable for counting short motion bursts.

---

### LDR GL5528 — Light Sensor

The LDR is wired in a voltage divider with a 10 kΩ fixed resistor. The ADC pin reads the midpoint voltage between them.

| Connection | Connects to |
|---|---|
| LDR leg 1 | ESP32 3.3 V |
| LDR leg 2 | ESP32 GPIO 34 **and** top of 10 kΩ resistor |
| Bottom of 10 kΩ resistor | ESP32 GND |

> **GPIO 34 is input-only on the ESP32.** It has no internal pull-up or output driver. Do not use it as an output or apply more than 3.3 V to it. As brightness increases, LDR resistance drops, node voltage rises, and the ADC count increases toward 4095.

---

### INMP441 — I2S Microphone

The INMP441 uses the I2S digital audio protocol over four wires.

| INMP441 Pin | Connects to |
|---|---|
| VDD | ESP32 3.3 V |
| GND | ESP32 GND |
| SD (serial data out) | ESP32 GPIO 32 |
| SCK (serial clock) | ESP32 GPIO 14 |
| WS (word select / LR clock) | ESP32 GPIO 15 |
| L/R | ESP32 GND |

> **The L/R pin must be tied to GND.** This selects the left I2S channel. If left floating the microphone may not output data or may switch channels unpredictably. The firmware configures `I2S_CHANNEL_FMT_ONLY_LEFT` to match.

---

## Arduino IDE Setup

1. **Install Arduino IDE 2.x** from [arduino.cc/en/software](https://www.arduino.cc/en/software).

2. **Add the ESP32 board package URL.** Open *File → Preferences* and paste the following into the *Additional boards manager URLs* field:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```

3. **Install the ESP32 board package.** Open *Tools → Board → Boards Manager*, search for `esp32`, and install **esp32 by Espressif Systems** (version 2.x or later).

4. **Install the DHT library.** Open *Tools → Manage Libraries*, search for `DHT sensor library`, and install **DHT sensor library by Adafruit**. When prompted, also install the **Adafruit Unified Sensor** dependency.

5. **Select the board.** Go to *Tools → Board → esp32 → ESP32 Dev Module*.

6. **Select the port.** Go to *Tools → Port* and select the COM port that appeared when you plugged in the ESP32. On macOS it looks like `/dev/cu.usbserial-*`. On Linux it looks like `/dev/ttyUSB0`. On Windows it looks like `COM3` or similar.

---

## Configuration Before Flashing

Open `firmware/main/config.h` and set the following values before every flash. The firmware will not work with the placeholder defaults.

| Define | What to set | Where to find it |
|---|---|---|
| `WIFI_SSID` | Your WiFi network name (2.4 GHz only — ESP32 does not support 5 GHz) | Your router label or settings page |
| `WIFI_PASSWORD` | Your WiFi password | Your router label or settings page |
| `BACKEND_URL` | Full ingest URL with your machine's LAN IP | Printed in the terminal on `docker compose up` — look for `ESP32 URL:` |
| `ROOM_ID` | The room slug for this device | Settings page → Add Room → the read-only Room ID field |

**`ROOM_ID` must exactly match the slug shown in the dashboard.** The slug is lowercase with underscores — for example `library_floor_2`, not `Library Floor 2`. The backend validates `room_id` on every ingest request and returns `404` for any unrecognised value. Register the room in the dashboard before flashing.

---

## Flashing

1. Open `firmware/main/main.ino` in Arduino IDE. The IDE will automatically load `config.h` and `sensors.h` from the same folder as additional tabs.
2. Edit `config.h` with your WiFi credentials, backend URL, and room ID.
3. Connect the ESP32 to your computer via USB.
4. Click the **Upload** button (→) or press `Ctrl+U`.
5. Wait for *Done uploading* in the status bar.
6. Open *Tools → Serial Monitor*, set the baud rate to **115200**, and press the **EN (reset) button** on the ESP32 to see the startup logs.

---

## Serial Monitor Output

### Healthy startup and normal operation

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 StudySpace IoT — Firmware Starting
 Room ID:    library_floor_2
 Backend:    http://192.168.1.50:8000/api/ingest
 Interval:   5000 ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[INFO] Connecting to WiFi: MyNetwork......
[OK]   WiFi connected. IP: 192.168.1.101
[INFO] Setup complete. Starting sensor loop.
[INFO] Sensors read:
       Temp=23.5°C  Hum=58.2%  Motion=1  Light=2847  SoundRMS=14230
[OK]   201 — payload sent: {"room_id":"library_floor_2","timestamp":"2026-04-21T10:00:00Z",...}
[INFO] Sensors read:
       Temp=23.5°C  Hum=58.3%  Motion=0  Light=2851  SoundRMS=12104
[OK]   201 — payload sent: {"room_id":"library_floor_2","timestamp":"2026-04-21T10:00:05Z",...}
```

### Failure examples

```
[ERROR] HTTP failed: connection refused
[WARN]  Unexpected response: 404  body: {"detail":"Room not registered. Register this room in the dashboard before flashing."}
[ERROR] Sensor read failed (DHT22 returned NaN) — skipping cycle
[WARN]  WiFi disconnected — skipping send, will retry next cycle
[WARN]  NTP not synced — using epoch fallback timestamp
[ERROR] WiFi connection timed out — restarting
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Stuck on `Connecting to WiFi......` indefinitely, then restarts | Wrong SSID or password in `config.h`, or ESP32 is out of range | Double-check `WIFI_SSID` and `WIFI_PASSWORD`; move ESP32 closer to the router |
| `404 — Room not registered` | `ROOM_ID` in `config.h` does not match any registered room slug | Open Settings in the dashboard, add the room, copy the exact slug shown in the Room ID field |
| `connection refused` | Backend is not running, or `BACKEND_URL` has the wrong IP or port | Run `docker compose up` from the monorepo root; copy the `ESP32 URL:` line from the terminal output |
| DHT22 reads `nan`, cycle is skipped | Missing 10 kΩ pull-up resistor on the DATA line, or loose wiring on GPIO 4 | Add the pull-up between DHT22 pin 2 and 3.3 V; reseat all connections |
| `SoundRMS=0` on every reading | I2S wiring error or wrong pin assignment | Check that SCK→GPIO14, WS→GPIO15, SD→GPIO32, L/R→GND — a single swapped wire silences the mic |
| Light raw always 0 or always 4095 | LDR voltage divider not wired correctly | Check that the 10 kΩ resistor is between GPIO 34 and GND, and the LDR is between 3.3 V and GPIO 34 |
| Reboots every 30 seconds after WiFi connects | NTP servers unreachable — the first timestamp call spins until timeout then the watchdog triggers a restart | Confirm the WiFi network has internet access; the ESP32 needs `pool.ntp.org` to be reachable |
| `422 Unprocessable Entity` response | Sensor values outside validation bounds (e.g. temperature below −40°C or above 80°C) | Likely a wiring or DHT22 fault producing out-of-range readings |
| Upload fails — `A fatal error occurred: Failed to connect to ESP32` | ESP32 not in flash mode | Hold the `BOOT` button on the ESP32 while clicking Upload, release after the upload starts |

---

## Adding This Room to a New ESP32

When you need a second device for a second study room the steps are the same but with a different `ROOM_ID`:

1. Open the Settings page at `http://localhost:3000/settings`.
2. Click **Add Room** and enter the new room's display name.
3. Note the auto-generated room slug shown in the read-only Room ID field.
4. Open `firmware/main/config.h` on the new ESP32's development machine.
5. Set `ROOM_ID` to the new slug. Leave `WIFI_SSID`, `WIFI_PASSWORD`, and `BACKEND_URL` the same if the network environment is the same.
6. Flash the new ESP32.
7. Confirm `201` responses in the Serial Monitor.

Each ESP32 is independently identified by its `ROOM_ID`. Multiple devices can post to the same backend simultaneously — the backend routes each payload to the correct room by `room_id`.
