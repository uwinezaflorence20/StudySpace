import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getAnomalies, getRooms } from '../api/client';

const STYLES = `
  .an-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
  }
  .an-title { font-size: 1.5rem; font-weight: 700; }
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: flex-end;
    padding: 16px 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    margin-bottom: 24px;
  }
  .filter-field { display: flex; flex-direction: column; gap: 5px; }
  .filter-field label {
    font-size: 0.75rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .filter-field select,
  .filter-field input {
    padding: 7px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.875rem;
  }
  .filter-field select:focus,
  .filter-field input:focus { outline: none; border-color: var(--accent); }
  .btn-primary {
    padding: 8px 16px;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    align-self: flex-end;
    transition: opacity 0.15s;
  }
  .btn-primary:hover { opacity: 0.85; }
  .btn-secondary {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--muted);
    font-size: 0.875rem;
    align-self: flex-end;
    transition: border-color 0.15s, color 0.15s;
  }
  .btn-secondary:hover { border-color: var(--text); color: var(--text); }
  .an-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  .an-table th {
    text-align: left;
    padding: 10px 14px;
    color: var(--muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--border);
    font-weight: 500;
  }
  .an-table td {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .an-table tr:last-child td { border-bottom: none; }
  .an-table tr:hover td { background: rgba(255,255,255,0.02); }
  .metric-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(99,102,241,0.15);
    color: var(--accent);
    font-size: 0.78rem;
    font-family: monospace;
  }
  .table-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
  }
  .an-empty {
    padding: 48px;
    text-align: center;
    color: var(--muted);
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
    margin-bottom: 16px;
  }
  .room-link {
    color: var(--blue);
    font-size: 0.85rem;
    font-family: monospace;
  }
  .room-link:hover { text-decoration: underline; }
`;

function formatTimestamp(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-RW', {
    timeZone: 'Africa/Kigali',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

export default function Anomalies() {
  const [anomalies, setAnomalies] = useState([]);
  const [rooms,     setRooms]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const [filterRoom, setFilterRoom] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo,   setFilterTo]   = useState('');

  const fetchAnomalies = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAnomalies(params);
      setAnomalies(data);
    } catch {
      setError('Failed to load anomalies.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnomalies();
    getRooms().then(setRooms).catch(() => {});
  }, [fetchAnomalies]);

  const handleFilter = () => {
    const params = {};
    if (filterRoom) params.roomId   = filterRoom;
    if (filterFrom) params.fromDate = filterFrom;
    if (filterTo)   params.toDate   = filterTo;
    fetchAnomalies(params);
  };

  const handleClear = () => {
    setFilterRoom('');
    setFilterFrom('');
    setFilterTo('');
    fetchAnomalies();
  };

  return (
    <>
      <style>{STYLES}</style>

      <div className="an-header">
        <h1 className="an-title">Anomalies</h1>
      </div>

      <div className="filter-bar">
        <div className="filter-field">
          <label>Room</label>
          <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)}>
            <option value="">All rooms</option>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>From</label>
          <input type="datetime-local" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>To</label>
          <input type="datetime-local" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={handleFilter}>Filter</button>
        <button className="btn-secondary" onClick={handleClear}>Clear</button>
      </div>

      {error && <div className="page-error">{error}</div>}

      {loading ? (
        <div className="spinner" />
      ) : anomalies.length === 0 ? (
        <div className="table-wrap"><div className="an-empty">No anomalies found.</div></div>
      ) : (
        <div className="table-wrap">
          <table className="an-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Room</th>
                <th>Metric</th>
                <th>Value</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {anomalies.map(a => (
                <tr key={a.id}>
                  <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {formatTimestamp(a.timestamp)}
                  </td>
                  <td>
                    <Link to={`/rooms/${a.room_id}`} className="room-link">{a.room_id}</Link>
                  </td>
                  <td><span className="metric-badge">{a.metric}</span></td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{a.value?.toFixed(2)}</td>
                  <td style={{ color: 'var(--muted)' }}>{a.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
