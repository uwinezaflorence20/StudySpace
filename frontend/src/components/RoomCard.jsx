import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLatestReading } from '../api/client';
import ComfortScore from './ComfortScore';

const STYLES = `
  .room-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    cursor: pointer;
    transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
    position: relative;
  }
  .room-card:hover {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), 0 4px 20px rgba(99,102,241,0.15);
    transform: translateY(-2px);
  }
  .rc-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .rc-name {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .rc-slug {
    font-size: 0.78rem;
    color: var(--muted);
    font-family: monospace;
  }
  .rc-dot {
    width: 9px; height: 9px;
    border-radius: 50%;
    background: var(--green);
    animation: rc-pulse 2.5s ease-in-out infinite;
    margin-top: 4px;
  }
  @keyframes rc-pulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34,197,94,0.5); }
    50%       { opacity: 0.6; box-shadow: 0 0 0 4px rgba(34,197,94,0); }
  }
  .rc-skeleton {
    height: 70px;
    background: linear-gradient(90deg, var(--border) 25%, var(--surface) 50%, var(--border) 75%);
    background-size: 200% 100%;
    border-radius: 8px;
    animation: shimmer 1.4s infinite;
  }
  @keyframes shimmer { to { background-position: -200% 0; } }
`;

export default function RoomCard({ room }) {
  const navigate = useNavigate();
  const [score,   setScore]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetch = () => {
      getLatestReading(room.id)
        .then(r  => { if (!cancelled) { setScore(r.comfort_score); setLoading(false); } })
        .catch(() => { if (!cancelled) { setScore(null);            setLoading(false); } });
    };

    fetch();
    const interval = setInterval(fetch, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [room.id]);

  return (
    <>
      <style>{STYLES}</style>
      <div
        className="room-card"
        onClick={() => navigate(`/rooms/${room.id}`)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && navigate(`/rooms/${room.id}`)}
      >
        <div className="rc-top">
          <div>
            <div className="rc-name">{room.name}</div>
            <div className="rc-slug">{room.id}</div>
          </div>
          <div className="rc-dot" />
        </div>

        {loading ? (
          <div className="rc-skeleton" />
        ) : (
          <ComfortScore score={score} />
        )}
      </div>
    </>
  );
}
