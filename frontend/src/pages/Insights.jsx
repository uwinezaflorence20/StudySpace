import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRooms, getCorrelation, getLabelDistribution, getPrediction } from '../api/client';

const STYLES = `
  .ins-title { font-size: 1.5rem; font-weight: 700; margin-bottom: 28px; }
  .ins-room-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 28px;
  }
  .ins-room-bar label { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .ins-room-bar select {
    padding: 8px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 0.875rem;
  }
  .ins-room-bar select:focus { outline: none; border-color: var(--accent); }
  .ins-section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 22px 26px;
    margin-bottom: 24px;
  }
  .ins-section h2 {
    font-size: 0.82rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 6px;
  }
  .ins-section-sub {
    font-size: 0.8rem;
    color: var(--muted);
    margin-bottom: 20px;
    line-height: 1.6;
  }
  .heatmap-wrap {
    overflow-x: auto;
  }
  .heatmap-grid {
    display: grid;
    grid-template-columns: 90px repeat(5, 80px);
    gap: 2px;
    font-size: 0.72rem;
    min-width: 500px;
  }
  .hm-cell {
    height: 54px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    font-weight: 600;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0,0,0,0.4);
  }
  .hm-label {
    height: 54px;
    display: flex;
    align-items: center;
    padding-right: 8px;
    font-size: 0.72rem;
    color: var(--muted);
    word-break: break-word;
    line-height: 1.3;
  }
  .hm-col-label {
    height: 36px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    font-size: 0.68rem;
    color: var(--muted);
    text-align: center;
    line-height: 1.2;
    padding-bottom: 4px;
    word-break: break-word;
  }
  .hm-corner { height: 36px; }
  .hm-legend {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .hm-legend-bar {
    flex: 1;
    max-width: 200px;
    height: 8px;
    border-radius: 4px;
    background: linear-gradient(to right, #3b82f6, #e5e7eb, #ef4444);
  }
  .label-bar-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    font-size: 0.82rem;
  }
  .label-bar-name {
    width: 110px;
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
  .label-bar-fill { height: 100%; border-radius: 5px; }
  .label-bar-count { color: var(--muted); min-width: 40px; text-align: right; }
  .pred-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 14px;
    margin-top: 4px;
  }
  .pred-stat { display: flex; flex-direction: column; gap: 4px; }
  .pred-stat-label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .pred-stat-value { font-size: 1.15rem; font-weight: 700; }
  .pred-match-yes { color: var(--green); }
  .pred-match-no  { color: var(--yellow); }
  .feat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
    margin-top: 14px;
  }
  .feat-item {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 0.78rem;
  }
  .feat-name { color: var(--muted); margin-bottom: 2px; }
  .feat-val  { font-weight: 600; }
  .imp-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 0.8rem;
  }
  .imp-name { width: 140px; color: var(--muted); flex-shrink: 0; }
  .imp-track { flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
  .imp-fill  { height: 100%; border-radius: 4px; background: var(--accent); }
  .imp-val   { width: 44px; text-align: right; color: var(--muted); font-size: 0.75rem; }
  .not-trained {
    padding: 24px;
    text-align: center;
    color: var(--muted);
    line-height: 1.7;
    font-size: 0.875rem;
  }
  .not-trained code {
    font-family: monospace;
    background: var(--border);
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--text);
  }
  .spinner {
    width: 32px; height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin: 32px auto;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .page-error {
    padding: 14px 18px;
    background: rgba(239,68,68,0.1);
    border: 1px solid rgba(239,68,68,0.3);
    border-radius: 8px;
    color: var(--red);
    margin-bottom: 16px;
  }
`;

const METRIC_LABELS = {
  temperature:       'Temp (°C)',
  humidity:          'Humidity (%)',
  sound_db:          'Sound (dB)',
  light_lux:         'Light (lux)',
  movements_per_min: 'Motion (mov/min)',
};

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

function corrColor(r) {
  if (r > 0) {
    const t = Math.min(1, r);
    return `rgba(239,68,68,${0.15 + t * 0.75})`;
  }
  const t = Math.min(1, -r);
  return `rgba(59,130,246,${0.15 + t * 0.75})`;
}

export default function Insights() {
  const navigate = useNavigate();
  const [rooms,       setRooms]       = useState([]);
  const [roomId,      setRoomId]      = useState('');
  const [corr,        setCorr]        = useState(null);
  const [labelDist,   setLabelDist]   = useState([]);
  const [prediction,  setPrediction]  = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);

  useEffect(() => {
    getRooms().then(rs => {
      setRooms(rs);
      if (rs.length > 0) setRoomId(rs[0].id);
    }).catch(() => {});
  }, []);

  const loadData = useCallback(async (id) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [c, d, p] = await Promise.all([
        getCorrelation(id, 500),
        getLabelDistribution(id),
        getPrediction(id),
      ]);
      setCorr(c);
      setLabelDist(d);
      setPrediction(p);
    } catch (err) {
      setError('Failed to load insights. Make sure there are enough readings in the database.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(roomId); }, [roomId, loadData]);

  const distTotal = labelDist.reduce((s, r) => s + r.count, 0);

  return (
    <>
      <style>{STYLES}</style>
      <h1 className="ins-title">Insights</h1>

      <div className="ins-room-bar">
        <label>Room</label>
        <select value={roomId} onChange={e => setRoomId(e.target.value)}>
          {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      {error && <div className="page-error">{error}</div>}
      {loading && <div className="spinner" />}

      {!loading && corr && (
        <>
          {/* ── Correlation Heatmap ─────────────────────────────────────────── */}
          <div className="ins-section">
            <h2>Sensor Correlation Matrix</h2>
            <p className="ins-section-sub">
              Pearson correlation computed over the last {corr.n_readings.toLocaleString()} readings.
              Red cells indicate positive correlation (metrics rise together); blue cells indicate
              inverse correlation. Values near 0 show no linear relationship.
              |r|&nbsp;&gt;&nbsp;0.7 is strong · |r|&nbsp;&gt;&nbsp;0.4 is moderate.
            </p>
            <div className="heatmap-wrap">
              <div className="heatmap-grid">
                <div className="hm-corner" />
                {corr.metrics.map(m => (
                  <div className="hm-col-label" key={m}>{METRIC_LABELS[m] ?? m}</div>
                ))}
                {corr.metrics.map((rowMetric, ri) => (
                  <React.Fragment key={rowMetric}>
                    <div className="hm-label">{METRIC_LABELS[rowMetric] ?? rowMetric}</div>
                    {corr.matrix[ri].map((val, ci) => (
                      <div
                        key={ci}
                        className="hm-cell"
                        style={{ background: corrColor(val) }}
                        title={`${METRIC_LABELS[corr.metrics[ri]]} vs ${METRIC_LABELS[corr.metrics[ci]]}: r = ${val.toFixed(3)}`}
                      >
                        {val.toFixed(2)}
                      </div>
                    ))}
                  </React.Fragment>
                ))}
              </div>
              <div className="hm-legend">
                <span>−1</span>
                <div className="hm-legend-bar" />
                <span>+1</span>
                <span style={{ marginLeft: 12 }}>Blue = inverse · Red = direct</span>
              </div>
            </div>
          </div>

          {/* ── Label Distribution ──────────────────────────────────────────── */}
          <div className="ins-section">
            <h2>Condition Classification — last 24 h</h2>
            <p className="ins-section-sub">
              Each reading is assigned one label by rule-based logic (priority order: poor → warm →
              humid → noisy → dim → crowded → comfortable → moderate). The bars show how often
              each condition occurred.
            </p>
            {labelDist.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No labelled readings in the last 24 hours.</p>
            ) : labelDist.map(({ label, count }) => (
              <div className="label-bar-row" key={label}>
                <span className="label-bar-name">{label}</span>
                <div className="label-bar-track">
                  <div
                    className="label-bar-fill"
                    style={{
                      width: `${(count / distTotal) * 100}%`,
                      background: LABEL_COLORS[label] ?? 'var(--accent)',
                    }}
                  />
                </div>
                <span className="label-bar-count">{count} ({((count / distTotal) * 100).toFixed(1)} %)</span>
              </div>
            ))}
          </div>

          {/* ── ML Prediction ───────────────────────────────────────────────── */}
          <div className="ins-section">
            <h2>ML Model Prediction</h2>
            <p className="ins-section-sub">
              A Random Forest classifier trained in the analysis notebook predicts the comfort label
              from the five normalised sensor values. The rule label is what the hand-written logic
              decided; the ML label is the model's independent prediction. When they disagree it
              means the model found a pattern the rules don't capture.
            </p>

            {!prediction || prediction.status === 'not_trained' ? (
              <div className="not-trained">
                <p>Model not trained yet.</p>
                <p>
                  Open <code>analysis/studyspace_analysis.ipynb</code> in VS Code and run all cells.
                  The notebook will train the classifier and save it to{' '}
                  <code>backend/models/comfort_classifier.pkl</code>.
                  Refresh this page afterwards.
                </p>
              </div>
            ) : (
              <>
                <div className="pred-grid">
                  <div className="pred-stat">
                    <span className="pred-stat-label">ML Prediction</span>
                    <span className="pred-stat-value" style={{ color: LABEL_COLORS[prediction.predicted_label] ?? 'var(--accent)', textTransform: 'capitalize' }}>
                      {prediction.predicted_label}
                    </span>
                  </div>
                  <div className="pred-stat">
                    <span className="pred-stat-label">Confidence</span>
                    <span className="pred-stat-value">{(prediction.confidence * 100).toFixed(1)} %</span>
                  </div>
                  <div className="pred-stat">
                    <span className="pred-stat-label">Rule Label</span>
                    <span className="pred-stat-value" style={{ color: LABEL_COLORS[prediction.rule_label] ?? 'var(--muted)', textTransform: 'capitalize' }}>
                      {prediction.rule_label ?? '—'}
                    </span>
                  </div>
                  <div className="pred-stat">
                    <span className="pred-stat-label">Agreement</span>
                    <span className={`pred-stat-value ${prediction.labels_match ? 'pred-match-yes' : 'pred-match-no'}`}>
                      {prediction.labels_match ? 'Match' : 'Differs'}
                    </span>
                  </div>
                </div>

                {Object.keys(prediction.feature_importances ?? {}).length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                      Feature Importances
                    </div>
                    {Object.entries(prediction.feature_importances)
                      .sort((a, b) => b[1] - a[1])
                      .map(([feat, imp]) => (
                        <div className="imp-row" key={feat}>
                          <span className="imp-name">{METRIC_LABELS[feat] ?? feat}</span>
                          <div className="imp-track">
                            <div className="imp-fill" style={{ width: `${imp * 100}%` }} />
                          </div>
                          <span className="imp-val">{(imp * 100).toFixed(1)} %</span>
                        </div>
                      ))}
                  </div>
                )}

                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                    Input Features (latest reading)
                  </div>
                  <div className="feat-grid">
                    {Object.entries(prediction.features ?? {}).map(([feat, val]) => (
                      <div className="feat-item" key={feat}>
                        <div className="feat-name">{METRIC_LABELS[feat] ?? feat}</div>
                        <div className="feat-val">{typeof val === 'number' ? val.toFixed(2) : val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
