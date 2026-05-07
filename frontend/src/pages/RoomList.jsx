import React, { useEffect, useState, useCallback } from 'react';
import { getRooms, createRoom } from '../api/client';
import RoomCard from '../components/RoomCard';

const STYLES = `
  .rl-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 28px;
  }
  .rl-title { font-size: 1.5rem; font-weight: 700; }
  .btn-primary {
    padding: 8px 18px;
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
  .rl-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
  }
  .rl-empty {
    text-align: center;
    padding: 64px 24px;
    color: var(--muted);
  }
  .rl-empty p { margin-bottom: 20px; font-size: 1rem; }
  .spinner {
    width: 36px; height: 36px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin: 64px auto;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
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
  .modal-actions {
    display: flex; gap: 10px; margin-top: 20px;
  }
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
  .modal-error {
    margin-top: 12px;
    padding: 8px 12px;
    background: rgba(239,68,68,0.1);
    border: 1px solid rgba(239,68,68,0.3);
    border-radius: 6px;
    color: var(--red);
    font-size: 0.85rem;
  }
  .page-error {
    padding: 14px 18px;
    background: rgba(239,68,68,0.1);
    border: 1px solid rgba(239,68,68,0.3);
    border-radius: 8px;
    color: var(--red);
    margin-bottom: 24px;
  }
`;

function slugify(name) {
  return name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

export default function RoomList() {
  const [rooms,    setRooms]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [roomName, setRoomName]  = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState(null);

  const fetchRooms = useCallback(async () => {
    try {
      const data = await getRooms();
      setRooms(data);
      setError(null);
    } catch (err) {
      setError('Failed to load rooms. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  const openModal  = () => { setRoomName(''); setModalError(null); setShowModal(true); };
  const closeModal = () => { setShowModal(false); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    setSubmitting(true);
    setModalError(null);
    try {
      await createRoom(roomName.trim());
      await fetchRooms();
      closeModal();
    } catch (err) {
      const msg = err.response?.data?.detail || 'Failed to create room.';
      setModalError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <style>{STYLES}</style>

      <div className="rl-header">
        <h1 className="rl-title">Rooms</h1>
        <button className="btn-primary" onClick={openModal}>+ Add Room</button>
      </div>

      {error && <div className="page-error">{error}</div>}

      {loading ? (
        <div className="spinner" />
      ) : rooms.length === 0 ? (
        <div className="rl-empty">
          <p>No rooms registered yet.</p>
          <button className="btn-primary" onClick={openModal}>+ Add your first room</button>
        </div>
      ) : (
        <div className="rl-grid">
          {rooms.map(room => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Add Room</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={roomName}
                  onChange={e => setRoomName(e.target.value)}
                  placeholder="e.g. Library Floor 2"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Room ID (auto-generated)</label>
                <input type="text" value={slugify(roomName)} readOnly />
              </div>
              {modalError && <div className="modal-error">{modalError}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ flex: 2 }} disabled={submitting || !roomName.trim()}>
                  {submitting ? 'Creating…' : 'Create Room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
