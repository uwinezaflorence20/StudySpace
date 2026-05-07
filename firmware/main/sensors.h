#ifndef SENSORS_H
#define SENSORS_H

#include <DHT.h>
#include <driver/i2s.h>
#include "config.h"

// ─── Sensor Data Struct ───────────────────────────────────────────────────────
struct SensorData {
  float temperature;  // °C from DHT22
  float humidity;     // % RH from DHT22
  int   motionCount;  // rising-edge interrupt count accumulated since last read
  int   lightRaw;     // 12-bit ADC count 0–4095 from LDR voltage divider
  int   soundRms;     // RMS amplitude computed from I2S_SAMPLE_COUNT samples
  bool  valid;        // false if any critical reading failed (e.g. DHT timeout)
};

// ─── Motion Interrupt Counter ────────────────────────────────────────────────
// volatile tells the compiler this variable can change outside normal code flow
// (inside an ISR) so it must never be cached in a register.
volatile int _motionCount = 0;

// IRAM_ATTR places this function in IRAM (internal RAM) rather than flash.
// ESP32 flash reads are temporarily suspended during write/erase operations;
// any ISR stored in flash would crash during those windows. IRAM is always
// accessible so this guarantees the handler runs at any time.
void IRAM_ATTR onMotion() {
  _motionCount++;
}

// ─── Sensor Initialization ───────────────────────────────────────────────────
// Call once from setup(). The DHT object is defined in main.ino and declared
// extern here so sensors.h can call dht.begin() without owning the object.
extern DHT dht;

void initSensors() {
  // DHT22 requires ~1 s after power-on before the first reading is valid
  dht.begin();

  // PIR: configure as digital input then attach the rising-edge ISR.
  // RISING triggers once per detected motion burst (HC-SR501 output goes HIGH).
  pinMode(PIR_PIN, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIR_PIN), onMotion, RISING);

  // LDR: GPIO34 is ADC1 channel 6 — input-only, no further config needed
  pinMode(LDR_PIN, INPUT);

  // ── I2S driver for INMP441 ─────────────────────────────────────────────────
  i2s_config_t i2s_config = {
    // Master RX: the ESP32 generates the clocks and the mic sends data
    .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate          = I2S_SAMPLE_RATE,
    // INMP441 outputs 24-bit audio packed into a 32-bit I2S frame.
    // We read as 32-bit and right-shift later to extract the actual 24 bits.
    .bits_per_sample      = I2S_BITS_PER_SAMPLE_32BIT,
    // L/R pin tied to GND → always outputs on the left channel
    .channel_format       = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_I2S,
    .intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1,
    // DMA buffers: 8 buffers × 64 samples each. More buffers = less risk of
    // overflow if the main loop is briefly delayed, at the cost of latency.
    .dma_buf_count        = 8,
    .dma_buf_len          = 64,
    .use_apll             = false,
    .tx_desc_auto_clear   = false,
    .fixed_mclk           = 0
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num   = I2S_SCK_PIN,
    .ws_io_num    = I2S_WS_PIN,
    .data_out_num = I2S_PIN_NO_CHANGE,  // TX not used — receive-only mode
    .data_in_num  = I2S_SD_PIN
  };

  // I2S_NUM_0 is the first (and typically only needed) I2S peripheral
  i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pin_config);
  // Flush any stale samples that accumulated during driver startup
  i2s_zero_dma_buffer(I2S_NUM_0);
}

// ─── Read All Sensors ─────────────────────────────────────────────────────────
SensorData readSensors() {
  SensorData data = { 0.0f, 0.0f, 0, 0, 0, true };

  // ── DHT22 ──────────────────────────────────────────────────────────────────
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  // isnan() check is mandatory — the DHT library returns NaN on timeout or
  // CRC failure rather than a sentinel integer so arithmetic comparisons fail
  if (isnan(t) || isnan(h)) {
    data.valid = false;
    return data;  // no point reading the other sensors if we can't validate
  }
  data.temperature = t;
  data.humidity    = h;

  // ── HC-SR501 (Motion) ──────────────────────────────────────────────────────
  // Disable interrupts for the minimum time needed to copy + reset the counter.
  // Without this, an interrupt between the read and the reset would lose a count:
  //   read  → ISR fires → count++ → reset to 0  →  that interrupt is lost
  noInterrupts();
  data.motionCount = _motionCount;
  _motionCount     = 0;
  interrupts();

  // ── LDR ───────────────────────────────────────────────────────────────────
  // ESP32 ADC1 is 12-bit → 0–4095. analogRead blocks for ~10 µs, acceptable.
  data.lightRaw = analogRead(LDR_PIN);

  // ── INMP441 (I2S) ─────────────────────────────────────────────────────────
  // Allocate sample buffer on the stack — I2S_SAMPLE_COUNT is small (1024)
  // so stack allocation is fine; heap fragmentation is avoided.
  int32_t samples[I2S_SAMPLE_COUNT];
  size_t bytesRead = 0;

  // i2s_read is synchronous and blocks until the DMA buffer has enough data
  // or the timeout expires (portMAX_DELAY = wait forever here, which is fine
  // because we know the driver is running and data arrives continuously)
  i2s_read(I2S_NUM_0,
           (void*)samples,
           sizeof(samples),
           &bytesRead,
           portMAX_DELAY);

  // Compute how many complete 32-bit samples were actually returned
  int samplesRead = bytesRead / sizeof(int32_t);

  // Compute RMS: sqrt( mean( x_i ^ 2 ) )
  // Use int64_t accumulator to avoid overflow: 2^23 squared is ~70 trillion,
  // which fits in int64_t (max ~9.2 × 10^18) for up to ~131k samples safely
  int64_t sumSquares = 0;
  for (int i = 0; i < samplesRead; i++) {
    // INMP441 left-justifies 24-bit audio in a 32-bit frame; the lower 8 bits
    // are always zero padding. Right-shift by 8 to recover the signed 24-bit
    // value before squaring — without this the RMS is inflated by 2^8 = 256×
    int32_t sample = samples[i] >> 8;
    sumSquares += (int64_t)sample * sample;
  }

  if (samplesRead > 0) {
    data.soundRms = (int)sqrt((double)sumSquares / samplesRead);
  }

  return data;
}

#endif // SENSORS_H
