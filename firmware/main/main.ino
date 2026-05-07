#include "config.h"
#include "sensors.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <time.h>

// DHT object defined here (in main.ino) and declared extern in sensors.h
// so initSensors() / readSensors() can reference it without owning it
DHT dht(DHT_PIN, DHT22);

// ─── NTP Timestamp Helper ─────────────────────────────────────────────────────
// Returns the current CAT time as an ISO 8601 string with explicit offset:
// "2026-04-21T12:00:00+02:00"
// NTP is configured on the first call. Subsequent calls just format the time.
// The backend's Pydantic parser accepts the +02:00 offset and PostgreSQL stores
// the value normalised to UTC in the TIMESTAMP WITH TIME ZONE column — correct.
String getISOTimestamp() {
  static bool ntpConfigured = false;

  if (!ntpConfigured) {
    // CAT_OFFSET_SEC = 7200 (UTC+2). Daylight offset = 0 (Rwanda has no DST).
    // configTime sets the ESP32 RTC so that localtime_r returns CAT wall-clock time.
    configTime(CAT_OFFSET_SEC, 0, "pool.ntp.org", "time.google.com");
    ntpConfigured = true;
  }

  // Spin-wait for NTP sync with a timeout so we never block indefinitely.
  // time(nullptr) returns seconds since Unix epoch; values below 1 billion
  // indicate the RTC has not yet been set (it resets to 0 on power-on).
  unsigned long start = millis();
  while (time(nullptr) < 1000000000UL) {
    if (millis() - start > NTP_SYNC_TIMEOUT_MS) {
      // Return a valid ISO string so the backend accepts the payload;
      // the backend will store it but the timestamp will be wrong
      Serial.println("[WARN] NTP not synced — using epoch fallback timestamp");
      return "1970-01-01T00:00:00+02:00";
    }
    delay(100);  // short delay inside the NTP spin-wait only, not the main loop
  }

  time_t now = time(nullptr);
  struct tm timeinfo;
  // localtime_r applies the CAT_OFFSET_SEC set in configTime, giving CAT wall-clock time.
  // gmtime_r would ignore the offset and return UTC — not what we want here.
  localtime_r(&now, &timeinfo);

  char buf[26];
  // ISO 8601 with explicit +02:00 offset — unambiguous to any parser
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S+02:00", &timeinfo);
  return String(buf);
}

// ─── WiFi Connection ─────────────────────────────────────────────────────────
void connectWiFi() {
  Serial.print("[INFO] Connecting to WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > 30000) {
      // After 30 s with no connection, restart the chip.
      // This handles a corrupted WiFi driver state that a simple retry won't fix.
      Serial.println("\n[ERROR] WiFi connection timed out — restarting");
      delay(500);  // brief delay so the Serial message flushes before restart
      ESP.restart();
    }
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("[OK] WiFi connected. IP: ");
  Serial.println(WiFi.localIP());
}

// ─── Setup ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  // Short delay so the Serial monitor has time to open before the banner prints
  delay(1000);

  Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Serial.println(" StudySpace IoT — Firmware Starting");
  Serial.print  (" Room ID:    "); Serial.println(ROOM_ID);
  Serial.print  (" Backend:    "); Serial.println(BACKEND_URL);
  Serial.print  (" Interval:   "); Serial.print(SEND_INTERVAL); Serial.println(" ms");
  Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  connectWiFi();
  initSensors();

  Serial.println("[INFO] Setup complete. Starting sensor loop.");
}

// ─── Main Loop ────────────────────────────────────────────────────────────────
void loop() {
  // Non-blocking timing: track when we last sent instead of sleeping.
  // delay(SEND_INTERVAL) would freeze the loop and cause the PIR interrupt
  // counter to keep incrementing with no chance to reset it between windows.
  static unsigned long lastSend = 0;

  if (millis() - lastSend < SEND_INTERVAL) {
    // Nothing to do yet — yield to background tasks (WiFi stack, watchdog)
    return;
  }
  lastSend = millis();

  // ── 1. Read sensors ────────────────────────────────────────────────────────
  SensorData data = readSensors();

  if (!data.valid) {
    Serial.println("[ERROR] Sensor read failed (DHT22 returned NaN) — skipping cycle");
    return;
  }

  Serial.println("[INFO] Sensors read:");
  Serial.print  ("       Temp="); Serial.print(data.temperature, 1); Serial.print("°C  ");
  Serial.print  ("Hum=");  Serial.print(data.humidity,    1); Serial.print("%  ");
  Serial.print  ("Motion="); Serial.print(data.motionCount); Serial.print("  ");
  Serial.print  ("Light="); Serial.print(data.lightRaw);    Serial.print("  ");
  Serial.print  ("SoundRMS="); Serial.println(data.soundRms);

  // ── 2. Build JSON payload ──────────────────────────────────────────────────
  // String concatenation is intentional — ArduinoJson is not listed as a
  // dependency and the payload schema is simple enough that manual assembly
  // is faster to flash and easier to read in this context.
  String payload = "{";
  payload += "\"room_id\":\""     + String(ROOM_ID)                  + "\",";
  payload += "\"timestamp\":\""   + getISOTimestamp()                + "\",";
  payload += "\"temperature\":"   + String(data.temperature, 2)      + ",";
  payload += "\"humidity\":"      + String(data.humidity,    2)      + ",";
  payload += "\"motion_count\":"  + String(data.motionCount)         + ",";
  payload += "\"light_raw\":"     + String(data.lightRaw)            + ",";
  payload += "\"sound_rms\":"     + String(data.soundRms);
  payload += "}";

  // ── 3. Check WiFi before sending ──────────────────────────────────────────
  // WiFi can drop silently between cycles. Attempting an HTTP call without
  // an active connection returns a cryptic error; this message is clearer.
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WARN] WiFi disconnected — skipping send, will retry next cycle");
    // Optionally call connectWiFi() here for auto-reconnect; omitted to keep
    // the loop non-blocking (connectWiFi() spins for up to 30 s)
    return;
  }

  // ── 4. HTTP POST ──────────────────────────────────────────────────────────
  HTTPClient http;
  http.begin(BACKEND_URL);
  http.addHeader("Content-Type", "application/json");

  int responseCode = http.POST(payload);

  if (responseCode == 201) {
    Serial.print("[OK] 201 — payload sent: ");
    Serial.println(payload);
  } else if (responseCode > 0) {
    // A positive code means the server responded but with an unexpected status.
    // Common cases: 404 = room not registered, 422 = validation error.
    Serial.print("[WARN] Unexpected response: ");
    Serial.print(responseCode);
    Serial.print("  body: ");
    Serial.println(http.getString());  // print server error message for diagnosis
  } else {
    // Negative codes are ESP32 HTTP client error codes, not HTTP status codes.
    // e.g. HTTPC_ERROR_CONNECTION_REFUSED (-1), HTTPC_ERROR_SEND_PAYLOAD_FAILED (-11)
    Serial.print("[ERROR] HTTP failed: ");
    Serial.println(http.errorToString(responseCode));
  }

  // Always call http.end() to release the TCP connection back to the pool.
  // Skipping this causes the ESP32 to exhaust its socket table after ~4 hours.
  http.end();
}
