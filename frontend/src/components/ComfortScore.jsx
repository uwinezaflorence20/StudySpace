import React from 'react';

function getScoreMeta(score) {
  if (score == null)  return { color: 'var(--muted)',   label: 'No data yet' };
  if (score >= 75)    return { color: 'var(--green)',   label: 'Good for studying' };
  if (score >= 50)    return { color: 'var(--yellow)',  label: 'Moderate conditions' };
  return               { color: 'var(--red)',    label: 'Poor conditions' };
}

const STYLES = `
  .cs-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 24px;
    display: flex;
    align-items: center;
    gap: 24px;
  }
  .cs-number-block { min-width: 80px; }
  .cs-number {
    font-size: 3rem;
    font-weight: 700;
    line-height: 1;
  }
  .cs-label {
    font-size: 0.8rem;
    color: var(--muted);
    margin-top: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .cs-bar-wrap { flex: 1; }
  .cs-bar-label {
    font-size: 0.85rem;
    margin-bottom: 8px;
    font-weight: 500;
  }
  .cs-bar-track {
    height: 10px;
    background: var(--border);
    border-radius: 99px;
    overflow: hidden;
  }
  .cs-bar-fill {
    height: 100%;
    border-radius: 99px;
    transition: width 0.5s ease;
  }
`;

export default function ComfortScore({ score }) {
  const { color, label } = getScoreMeta(score);
  const pct = score != null ? Math.min(100, Math.max(0, score)) : 0;

  return (
    <>
      <style>{STYLES}</style>
      <div className="cs-wrap">
        <div className="cs-number-block">
          <div className="cs-number" style={{ color }}>
            {score != null ? Math.round(score) : '—'}
          </div>
          <div className="cs-label">/ 100</div>
        </div>
        <div className="cs-bar-wrap">
          <div className="cs-bar-label" style={{ color }}>{label}</div>
          <div className="cs-bar-track">
            <div
              className="cs-bar-fill"
              style={{ width: `${pct}%`, background: color }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
