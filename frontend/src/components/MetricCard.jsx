import React from 'react';

const STATUS_COLOR = {
  good:    'var(--green)',
  warning: 'var(--yellow)',
  bad:     'var(--red)',
};

const STYLES = `
  .metric-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left-width: 3px;
    border-radius: 10px;
    padding: 16px 18px;
    cursor: pointer;
    transition: border-color 0.2s, transform 0.15s;
    user-select: none;
  }
  .metric-card:hover {
    transform: translateY(-1px);
    border-color: var(--accent);
  }
  .mc-label {
    font-size: 0.75rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }
  .mc-value-row {
    display: flex;
    align-items: baseline;
    gap: 4px;
    margin-bottom: 10px;
  }
  .mc-value {
    font-size: 2rem;
    font-weight: 700;
    line-height: 1;
  }
  .mc-unit {
    font-size: 0.9rem;
    color: var(--muted);
  }
  .mc-stats {
    display: flex;
    gap: 14px;
  }
  .mc-stat {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .mc-stat-label {
    font-size: 0.68rem;
    color: var(--muted);
    text-transform: uppercase;
  }
  .mc-stat-value {
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
`;

export default function MetricCard({ metric, value, unit, summary, status = 'good', onClick }) {
  const borderColor = STATUS_COLOR[status] ?? STATUS_COLOR.good;

  return (
    <>
      <style>{STYLES}</style>
      <div
        className="metric-card"
        style={{ borderLeftColor: borderColor }}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onClick?.()}
      >
        <div className="mc-label">{metric}</div>
        <div className="mc-value-row">
          <span className="mc-value" style={{ color: borderColor }}>
            {value != null ? (typeof value === 'number' ? value.toFixed(1) : value) : '—'}
          </span>
          <span className="mc-unit">{unit}</span>
        </div>
        {summary && (
          <div className="mc-stats">
            {[['Avg', summary.avg], ['Min', summary.min], ['Max', summary.max]].map(([label, val]) => (
              <div className="mc-stat" key={label}>
                <span className="mc-stat-label">{label}</span>
                <span className="mc-stat-value">
                  {val != null ? val.toFixed(1) : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
