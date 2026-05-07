import React, { useEffect, useState, useCallback } from 'react';
import { getThresholds, updateThresholds, getRooms, deleteRoom, createRoom } from '../api/client';

const STYLES = `
  .settings-section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px 28px;
    margin-bottom: 28px;
  }
  .settings-section h2 {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .threshold-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 20px;
  }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field label {
    font-size: 0.78rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .field input {
    padding: 9px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.9rem;
  }
  .field input:focus { outline: none; border-color: var(--accent); }
  .btn-primary {
    padding: 9px 20px;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    transition: opacity 0.15s;
  }
  .btn-primary:hover { opacity: 0.85; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-danger {
    padding: 6px 14px;
    background: transparent;
    border: 1px solid var(--red);
    border-radius: 6px;
    color: var(--red);
    font-size: 0.8rem;
    transition: background 0.15s;
  }
  .btn-danger:hover { background: rgba(239,68,68,0.1); }
  .success-msg {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: 12px;
    font-size: 0.85rem;
    color: var(--green);
  }
  .error-msg {
    margin-top: 10px;
    padding: 8px 12px;
    background: rgba(239,68,68,0.1);
    border: 1px solid rgba(239,68,68,0.3);
    border-radius: 6px;
    color: var(--red);
    font-size: 0.85rem;
  }
  .room-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .room-row:last-child { border-bottom: none; }
  .room-info { display: flex; flex-direction: column; gap: 2px; }
  .room-name { font-weight: 500; font-size: 0.95rem; }
  .room-slug { font-size: 0.8rem; color: var(--muted); font-family: monospace; }
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .section-header h2 { border: none; margin: 0; padding: 0; }
  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 200;
  }
  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 28px;
    width: 420px;
    max-width: 90vw;
  }
  .modal h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 20px; }
  .form-group { margin-bottom: 16px; }
  .form-group label {
    display: block;
    font-size: 0.8rem;
    color: var(--muted);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .form-group input {
    width: 100%;
    padding: 9px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.9rem;
  }
  .form-group input:read-only { color: var(--muted); }
  .form-group input:focus { outline: none; border-color: var(--accent); }
  .modal-actions { display: flex; gap: 10px; margin-top: 20px; }
  .btn-secondary {
    flex: 1;
    padding: 8px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--muted);
    font-size: 0.875rem;
    transition: border-color 0.15s, color 0.15s;
  }
  .btn-secondary:hover { border-color: var(--text); color: var(--text); }
  .confirm-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 300;
  }
  .confirm-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 28px;
    width: 380px;
    max-width: 90vw;
  }
  .confirm-box p { margin-bottom: 20px; line-height: 1.6; font-size: 0.9rem; }
  .confirm-actions { display: flex; gap: 10px; }
  .spinner {
    width: 28px; height: 28px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin: 32px auto;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

const THRESHOLD_FIELDS = [
  { key: 'temp_min',            label: 'Temp Min',            unit: '°C' },
  { key: 'temp_max',            label: 'Temp Max',            unit: '°C' },
  { key: 'humidity_min',        label: 'Humidity Min',        unit: '%' },
  { key: 'humidity_max',        label: 'Humidity Max',        unit: '%' },
  { key: 'sound_max_db',        label: 'Sound Max',           unit: 'dB' },
  { key: 'light_min_lux',       label: 'Light Min',           unit: 'lux' },
  { key: 'light_max_lux',       label: 'Light Max',           unit: 'lux' },
  { key: 'motion_max_per_min',  label: 'Motion Max',          unit: 'mov/min' },
];

function slugify(name) {
  return name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

export default function Settings() {
  const [form,         setForm]         = useState({});
  const [rooms,        setRooms]        = useState([]);
  const [loadingT,     setLoadingT]     = useState(true);
  const [loadingR,     setLoadingR]     = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [saveSuccess,  setSaveSuccess]  = useState(false);
  const [saveError,    setSaveError]    = useState(null);
  const [confirmRoom,  setConfirmRoom]  = useState(null);  // room to delete
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRoomName,  setNewRoomName]  = useState('');
  const [addError,     setAddError]     = useState(null);
  const [addSubmitting, setAddSubmitting] = useState(false);

  const fetchThresholds = useCallback(async () => {
    try {
      const t = await getThresholds();
      setForm(t);
    } catch {
      setSaveError('Failed to load thresholds.');
    } finally {
      setLoadingT(false);
    }
  }, []);

  const fetchRooms = useCallback(async () => {
    try {
      const r = await getRooms();
      setRooms(r);
    } finally {
      setLoadingR(false);
    }
  }, []);

  useEffect(() => { fetchThresholds(); fetchRooms(); }, [fetchThresholds, fetchRooms]);

  const handleChange = (key, value) => {
    setForm(prev => ({ ...prev, [key]: parseFloat(value) }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const payload = {};
      THRESHOLD_FIELDS.forEach(({ key }) => { payload[key] = form[key]; });
      await updateThresholds(payload);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      setSaveError('Failed to save thresholds. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmRoom) return;
    try {
      await deleteRoom(confirmRoom.id);
      setConfirmRoom(null);
      await fetchRooms();
    } catch {
      setConfirmRoom(null);
    }
  };

  const handleAddRoom = async (e) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    setAddSubmitting(true);
    setAddError(null);
    try {
      await createRoom(newRoomName.trim());
      setShowAddModal(false);
      setNewRoomName('');
      await fetchRooms();
    } catch (err) {
      setAddError(err.response?.data?.detail || 'Failed to create room.');
    } finally {
      setAddSubmitting(false);
    }
  };

  return (
    <>
      <style>{STYLES}</style>

      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 28 }}>Settings</h1>

      {/* ── Thresholds ── */}
      <div className="settings-section">
        <h2>Comfort Thresholds</h2>
        {loadingT ? (
          <div className="spinner" />
        ) : (
          <>
            <div className="threshold-grid">
              {THRESHOLD_FIELDS.map(({ key, label, unit }) => (
                <div className="field" key={key}>
                  <label>{label} ({unit})</label>
                  <input
                    type="number"
                    step="0.1"
                    value={form[key] ?? ''}
                    onChange={e => handleChange(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save Thresholds'}
              </button>
              {saveSuccess && <span className="success-msg">✓ Saved</span>}
            </div>
            {saveError && <div className="error-msg">{saveError}</div>}
          </>
        )}
      </div>

      {/* ── Rooms ── */}
      <div className="settings-section">
        <div className="section-header">
          <h2>Room Management</h2>
          <button className="btn-primary" onClick={() => { setNewRoomName(''); setAddError(null); setShowAddModal(true); }}>
            + Add Room
          </button>
        </div>
        {loadingR ? (
          <div className="spinner" />
        ) : rooms.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>No rooms registered yet.</p>
        ) : (
          rooms.map(room => (
            <div className="room-row" key={room.id}>
              <div className="room-info">
                <span className="room-name">{room.name}</span>
                <span className="room-slug">{room.id}</span>
              </div>
              <button className="btn-danger" onClick={() => setConfirmRoom(room)}>Delete</button>
            </div>
          ))
        )}
      </div>

      {/* ── Sensor Calibration Reference ── */}
      <div className="settings-section">
        <h2>Sensor Calibration Reference</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 20, lineHeight: 1.7 }}>
          Each sensor has a fixed hardware reference value used to convert raw readings into physical
          units. These are determined by the sensor datasheets and circuit design — they are not
          configurable here. They are documented so that results can be independently verified and
          compared against a known reference.
        </p>
        {[
          {
            sensor: 'DHT22 — Temperature',
            ref: 'Factory-calibrated. No user calibration required.',
            formula: 'Direct °C output over single-wire protocol.',
            accuracy: '±0.5 °C typical, ±1 °C max. Valid range: −40 to 80 °C.',
            source: 'Aosong DHT22 datasheet, Section 5.1',
          },
          {
            sensor: 'DHT22 — Humidity',
            ref: 'Factory-calibrated. No user calibration required.',
            formula: 'Direct % RH output alongside temperature on same wire.',
            accuracy: '±2–5 % RH. Valid range: 0–100 % RH.',
            source: 'Aosong DHT22 datasheet, Section 5.2',
          },
          {
            sensor: 'GL5528 LDR — Light (ADC → lux)',
            ref: 'R_fixed = 10 000 Ω (fixed resistor in voltage divider). V_supply = 3.3 V.',
            formula: 'voltage = (ADC / 4095) × 3.3  →  R_ldr = (10000 × V) / (3.3 − V)  →  lux = 500 / (R_kΩ)^0.7',
            accuracy: '±20 % across 10–1000 lux. GL5528 power law is empirically derived from datasheet curve.',
            source: 'Sinosel GL5528 datasheet; Laszlo Monda, LDR Photoresistor Circuits (2019)',
          },
          {
            sensor: 'INMP441 I2S Microphone — Sound (RMS → dB SPL)',
            ref: 'Reference RMS = 420 426 counts → 94 dB SPL. Derived from INMP441 sensitivity: −26 dBFS at 94 dB SPL (1 kHz, 1 Pa), full-scale peak = 2²³ − 1 = 8 388 607.',
            formula: 'dB_SPL = 20 × log₁₀(rms / 420426) + 94',
            accuracy: '±3 dB SPL. Valid RMS range: 0 to 400 000 (24-bit scale clamp).',
            source: 'InvenSense INMP441 datasheet Rev 1.3, Table 1 (Sensitivity)',
          },
          {
            sensor: 'HC-SR501 PIR — Motion (count → mov/min)',
            ref: 'Sensitivity potentiometer set to ~3 m detection radius. Re-trigger mode enabled (H-bridge jumper).',
            formula: 'movements_per_min = motion_count × 12  (12 five-second windows per minute)',
            accuracy: 'Binary event counter — accuracy depends on PIR sensitivity trim. Multiplier assumes exactly 5 s firmware window.',
            source: 'HC-SR501 datasheet; firmware config.h MOTION_WINDOW_MS = 5000',
          },
        ].map(({ sensor, ref, formula, accuracy, source }) => (
          <div key={sensor} style={{
            padding: '16px 0',
            borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 8 }}>{sensor}</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.75 }}>
              <div><span style={{ color: 'var(--accent)', fontWeight: 500 }}>Reference: </span>{ref}</div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.79rem', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: 4, margin: '4px 0' }}>{formula}</div>
              <div><span style={{ color: 'var(--accent)', fontWeight: 500 }}>Accuracy: </span>{accuracy}</div>
              <div style={{ marginTop: 2, fontStyle: 'italic' }}>{source}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Delete confirmation ── */}
      {confirmRoom && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Are you sure you want to delete <strong>{confirmRoom.name}</strong>? This cannot be undone.</p>
            <div className="confirm-actions">
              <button className="btn-secondary" onClick={() => setConfirmRoom(null)}>Cancel</button>
              <button className="btn-danger" style={{ flex: 1 }} onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Room modal ── */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Add Room</h2>
            <form onSubmit={handleAddRoom}>
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={newRoomName}
                  onChange={e => setNewRoomName(e.target.value)}
                  placeholder="e.g. Library Floor 2"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Room ID (auto-generated)</label>
                <input type="text" value={slugify(newRoomName)} readOnly />
              </div>
              {addError && <div className="error-msg">{addError}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ flex: 2 }} disabled={addSubmitting || !newRoomName.trim()}>
                  {addSubmitting ? 'Creating…' : 'Create Room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
