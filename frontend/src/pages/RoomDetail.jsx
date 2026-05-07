import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRoom, getLatestReading, getRoomReadings, getRoomSummary, getThresholds, getLabelDistribution } from '../api/client';
import ComfortScore    from '../components/ComfortScore';
import MultiLineChart  from '../components/MultiLineChart';
import MetricCard      from '../components/MetricCard';

const STYLES = `
  .rd-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 28px;
  }
  .rd-title { font-size: 1.5rem; font-weight: 700; }
  .live-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: var(--green);
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.4; transform: scale(0.8); }
  }
  .rd-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    color: var(--muted);
    margin-bottom: 20px;
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
    transition: color 0.15s;
  }
  .rd-back:hover { color: var(--text); }
  .rd-section { margin-bottom: 32px; }
  .rd-metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    margin-top: 16px;
  }
  .rd-no-data {
    padding: 40px;
    text-align: center;
    color: var(--muted);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .spinner {
    width: 36px; height: 36px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin: 64px auto;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .page-error {
    padding: 14px 18px;
    background: rgba(239,68,68,0.1);
    border: 1px solid rgba(239,68,68,0.3);
    border-radius: 8px;
    color: var(--red);
  }
  .rd-info {
    margin-top: 28px;
    padding: 18px 22px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    font-size: 0.82rem;
    color: var(--muted);
    line-height: 1.7;
  }
  .rd-info h3 {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 10px;
  }
  .rd-score-breakdown {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 16px;
    margin: 12px 0 18px;
  }
  .rd-score-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.82rem;
  }
  .rd-score-row:last-child { border-bottom: none; }
  .rd-score-label { font-weight: 600; color: var(--text); min-width: 140px; }
  .rd-score-inputs { color: var(--muted); flex: 1; font-style: italic; }
  .rd-score-pts { font-weight: 700; color: var(--accent); min-width: 50px; text-align: right; }
  .rd-section-heading {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--text);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 20px 0 10px;
    padding-bottom: 7px;
    border-bottom: 1px solid var(--border);
  }
  .rd-formula {
    font-family: monospace;
    font-size: 0.79rem;
    background: rgba(0,0,0,0.2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 14px;
    margin: 10px 0;
    color: var(--text);
    line-height: 1.8;
  }
  .rd-source {
    font-size: 0.76rem;
    color: var(--muted);
    margin-top: 8px;
    font-style: italic;
    line-height: 1.6;
  }
  .rd-label-dist {
    margin: 28px 0;
    padding: 18px 22px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .rd-label-dist h3 {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 14px;
  }
  .label-bar-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    font-size: 0.82rem;
  }
  .label-bar-name {
    width: 100px;
    color: var(--muted);
    text-transform: capitalize;
    flex-shrink: 0;
  }
  .label-bar-track {
    flex: 1;
    height: 10px;
    background: var(--border);
    border-radius: 5px;
    overflow: hidden;
  }
  .label-bar-fill { height: 100%; border-radius: 5px; transition: width 0.4s; }
  .label-bar-count { color: var(--muted); min-width: 36px; text-align: right; }
`;

const METRIC_CONFIGS = [
  { key: 'temperature',       label: 'Temperature', unit: '°C'      },
  { key: 'humidity',          label: 'Humidity',    unit: '%'       },
  { key: 'sound_db',          label: 'Sound',       unit: 'dB'      },
  { key: 'light_lux',         label: 'Light',       unit: 'lux'     },
  { key: 'movements_per_min', label: 'Motion',      unit: 'mov/min' },
];

function getStatus(metric, value, thresholds) {
  if (!thresholds || value == null) return 'good';
  const within = (v, lo, hi) => v >= lo && v <= hi;
  const borderline = (v, lo, hi) => {
    const margin = (hi - lo) * 0.1;
    return v >= lo - margin && v <= hi + margin;
  };
  const map = {
    temperature: [thresholds.temp_min,     thresholds.temp_max],
    humidity:    [thresholds.humidity_min,  thresholds.humidity_max],
    sound_db:    [0,                         thresholds.sound_max_db],
    light_lux:   [thresholds.light_min_lux, thresholds.light_max_lux],
  };
  const range = map[metric];
  if (!range) return 'good';
  const [lo, hi] = range;
  if (within(value, lo, hi))     return 'good';
  if (borderline(value, lo, hi)) return 'warning';
  return 'bad';
}

export default function RoomDetail() {
  const { room_id } = useParams();
  const navigate    = useNavigate();

  const [room,          setRoom]          = useState(null);
  const [summary,       setSummary]       = useState(null);
  const [thresholds,    setThresholds]    = useState(null);
  const [readings,      setReadings]      = useState([]);
  const [labelDist,     setLabelDist]     = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);

  // Initial load — fetch room meta, summary, thresholds, and seed the chart
  // with the last 60 readings from the DB so the graph is never empty on mount
  useEffect(() => {
    (async () => {
      try {
        const [r, s, t, history, dist] = await Promise.all([
          getRoom(room_id),
          getRoomSummary(room_id),
          getThresholds(),
          getRoomReadings(room_id, 60),
          getLabelDistribution(room_id),
        ]);
        setRoom(r);
        setSummary(s);
        setThresholds(t);
        setLabelDist(dist);
        // API returns newest-first; reverse so the chart flows left→right
        setReadings(history.slice().reverse());
      } catch (err) {
        setError(err.response?.status === 404 ? 'Room not found.' : 'Failed to load room data.');
      } finally {
        setLoading(false);
      }
    })();
  }, [room_id]);

  // Rolling poll
  const fetchLatest = useCallback(async () => {
    try {
      const reading = await getLatestReading(room_id);
      setReadings(prev => {
        if (prev.length > 0 && prev[prev.length - 1].id === reading.id) return prev;
        const updated = [...prev, reading];
        return updated.length > 60 ? updated.slice(-60) : updated;
      });
    } catch {
      // 404 = no readings yet; ignore silently
    }
  }, [room_id]);

  useEffect(() => {
    fetchLatest();
    const interval = setInterval(fetchLatest, 3000);
    return () => clearInterval(interval);
  }, [fetchLatest]);

  if (loading) return <><style>{STYLES}</style><div className="spinner" /></>;
  if (error)   return <><style>{STYLES}</style><div className="page-error">{error}</div></>;

  const latest = readings[readings.length - 1] ?? null;

  return (
    <>
      <style>{STYLES}</style>

      <button className="rd-back" onClick={() => navigate('/')}>← All Rooms</button>

      <div className="rd-header">
        <div className="live-dot" />
        <h1 className="rd-title">{room.name}</h1>
      </div>

      <div className="rd-section">
        <ComfortScore score={latest?.comfort_score ?? null} />
      </div>

      {readings.length === 0 ? (
        <div className="rd-no-data">No readings yet. Waiting for the ESP32 to connect…</div>
      ) : (
        <>
          <div className="rd-section">
            <MultiLineChart data={readings} />
          </div>

          <div className="rd-metrics-grid">
            {METRIC_CONFIGS.map(({ key, label, unit }) => (
              <MetricCard
                key={key}
                metric={label}
                value={latest?.[key] ?? null}
                unit={unit}
                summary={summary?.[key] ?? null}
                status={getStatus(key, latest?.[key], thresholds)}
                onClick={() => navigate(`/rooms/${room_id}/metrics/${key}`)}
              />
            ))}
          </div>
        </>
      )}

      {labelDist.length > 0 && (() => {
        const LABEL_COLORS = {
          comfortable: '#22c55e',
          moderate:    '#eab308',
          warm:        '#f97316',
          humid:       '#3b82f6',
          noisy:       '#a855f7',
          dim:         '#64748b',
          crowded:     '#ef4444',
          poor:        '#dc2626',
        };
        const total = labelDist.reduce((s, r) => s + r.count, 0);
        return (
          <div className="rd-label-dist">
            <h3>Condition Classification — last 24 h</h3>
            {labelDist.map(({ label, count }) => (
              <div className="label-bar-row" key={label}>
                <span className="label-bar-name">{label}</span>
                <div className="label-bar-track">
                  <div
                    className="label-bar-fill"
                    style={{
                      width: `${(count / total) * 100}%`,
                      background: LABEL_COLORS[label] ?? 'var(--accent)',
                    }}
                  />
                </div>
                <span className="label-bar-count">{count}</span>
              </div>
            ))}
            <p style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 12 }}>
              Each reading is classified into one of eight labels by rule-based logic.
              Visit the <strong>Insights</strong> page to compare with the ML model's predictions.
            </p>
          </div>
        );
      })()}

      <div className="rd-info">
        <h3>How the comfort score is calculated</h3>
        <p style={{ marginBottom: 4 }}>
          The score groups the five sensor signals into three components that reflect how environmental
          science actually clusters them. Temperature and humidity cannot be scored independently —
          they interact through the physics of how the human body cools itself. Noise is amplified
          by crowding. Light stands alone.
        </p>

        <div className="rd-score-breakdown">
          <div className="rd-score-row">
            <span className="rd-score-label">Thermal comfort</span>
            <span className="rd-score-inputs">temperature + humidity → apparent temperature</span>
            <span className="rd-score-pts">40 pts</span>
          </div>
          <div className="rd-score-row">
            <span className="rd-score-label">Acoustic comfort</span>
            <span className="rd-score-inputs">sound dB, penalty amplified by motion (crowding)</span>
            <span className="rd-score-pts">35 pts</span>
          </div>
          <div className="rd-score-row">
            <span className="rd-score-label">Visual comfort</span>
            <span className="rd-score-inputs">illuminance in lux</span>
            <span className="rd-score-pts">25 pts</span>
          </div>
        </div>

        {/* ── Thermal ───────────────────────────────────────────────────────── */}
        <div className="rd-section-heading">Thermal Comfort — 40 pts</div>
        <p>
          Your body regulates core temperature by sweating. Sweat only cools you if it can evaporate,
          and it evaporates only when the surrounding air has room for more water vapour. At 28 °C
          with dry air (30 % RH) evaporation is fast and you feel comfortable. At 28 °C with
          saturated air (80 % RH) the sweat sits on your skin and you overheat — the thermometer
          reads identically in both cases. Evaluating temperature alone and humidity alone and
          adding the two scores misses this entirely.
        </p>
        <p style={{ marginTop: 10 }}>
          Instead, we compute the <strong style={{ color: 'var(--text)' }}>apparent temperature</strong> —
          what the combination actually feels like — using the formula published by the Australian
          Bureau of Meteorology and grounded in Steadman's (1994) human thermal physiology work.
          This is the same approach underpinning the ASHRAE Standard 55 adaptive comfort model:
        </p>
        <div className="rd-formula">
          <div>e  = (RH / 100) × 6.105 × exp(17.27 × T / (237.7 + T))   <span style={{color:'var(--muted)'}}>← vapour pressure in hPa</span></div>
          <div>AT = T + 0.33 × e − 4.0                                    <span style={{color:'var(--muted)'}}>← apparent temperature in °C</span></div>
        </div>
        <p style={{ marginTop: 4, fontSize: '0.8rem', color: 'var(--muted)' }}>
          The coefficient 0.33 translates each hPa of vapour pressure into a perceived
          temperature offset. The −4.0 term accounts for convective heat loss at typical indoor
          air velocities (~0.1 m/s). The result is compared against the configured range of{' '}
          {thresholds?.temp_min ?? 18}–{thresholds?.temp_max ?? 26} °C. The score decays to zero
          at 8 °C beyond either bound — ASHRAE 55-2023 §5.3 identifies this as the boundary where
          discomfort becomes physiological stress.
        </p>
        <p className="rd-source">
          Sources: ASHRAE Standard 55-2023, Thermal Environmental Conditions for Human Occupancy ·
          Steadman R.G. (1994) "Norms of apparent temperature in Australia", Australian Meteorological Magazine 43(1).
        </p>

        {/* ── Acoustic ──────────────────────────────────────────────────────── */}
        <div className="rd-section-heading">Acoustic Comfort — 35 pts</div>
        <p>
          The WHO Environmental Noise Guidelines (2018) recommend background noise in classrooms
          and study spaces stay below 35 dB LAeq for optimal learning outcomes. We use{' '}
          {thresholds?.sound_max_db ?? 40} dB as the threshold to account for the ambient noise
          floor of an occupied room (chairs, keyboards, ventilation). Every dB above that costs
          3.5 points, reaching zero at 10 dB over.
        </p>
        <p style={{ marginTop: 10 }}>
          But the same noise level is not equally disruptive in every situation. One person on a
          loud call is a single point source — you can turn away, move seats, or mentally filter it.
          Ten people having simultaneous conversations surrounds you; every direction carries
          speech and your brain cannot stop trying to parse it. Motion count is our proxy for
          occupancy. When movement exceeds {thresholds?.motion_max_per_min ?? 10} mov/min, the
          acoustic penalty is amplified — a crowded noisy room scores worse than a quiet one with
          the same dB reading.
        </p>
        <div className="rd-formula">
          <div>crowding_ratio = clamp(0,  (motion − motion_max) / motion_max,  1)</div>
          <div>amplification  = 1.0 + 0.5 × crowding_ratio                        <span style={{color:'var(--muted)'}}>← 1.0× to 1.5×</span></div>
          <div>acoustic_score = max(0,  35 − (dB_excess × 3.5) × amplification)</div>
        </div>
        <p className="rd-source">
          Sources: WHO Environmental Noise Guidelines for the European Region (2018) ·
          Klatte M. et al. (2010) "Effects of noise and reverberation on speech perception and
          listening comprehension in a classroom-like setting", Noise &amp; Health 12(49).
        </p>

        {/* ── Visual ────────────────────────────────────────────────────────── */}
        <div className="rd-section-heading">Visual Comfort — 25 pts</div>
        <p>
          EN 12464-1:2021 (European Standard, Lighting of Work Places) specifies a maintained
          illuminance of 500 lux for reading and writing tasks. Below 300 lux the eye muscles
          work harder to focus on fine text, causing strain and fatigue within 20–30 minutes.
          Above 1 000 lux glare begins to wash out contrast even without a direct light source
          in the field of view. The ideal band is{' '}
          {thresholds?.light_min_lux ?? 300}–{thresholds?.light_max_lux ?? 500} lux.
        </p>
        <p style={{ marginTop: 10 }}>
          The score decays to zero at 500 lux outside either bound. The tolerance is deliberately
          wide: the GL5528 LDR sensor carries a ±20 % accuracy limitation, and lux varies
          significantly across a room depending on proximity to windows and ceiling fixtures.
          Penalising hard at small deviations would be punishing sensor physics, not actual
          discomfort.
        </p>
        <p className="rd-source">
          Sources: EN 12464-1:2021, Light and Lighting — Lighting of Work Places ·
          IES Lighting Handbook, 10th ed. (2011), Chapter 10: Educational Facilities.
        </p>

        <p style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)', fontSize: '0.8rem' }}>
          Thresholds are configurable in Settings and apply to the next reading immediately.
          Avg / Min / Max on each metric card are computed over the last 24 hours of stored readings.
        </p>
      </div>
    </>
  );
}
