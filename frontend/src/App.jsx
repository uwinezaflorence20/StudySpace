import React from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import RoomList    from './pages/RoomList';
import RoomDetail  from './pages/RoomDetail';
import MetricDetail from './pages/MetricDetail';
import Anomalies   from './pages/Anomalies';
import Insights    from './pages/Insights';
import Settings    from './pages/Settings';

const NAV_STYLES = `
  .nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    height: 56px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .nav-brand {
    font-size: 1rem;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: -0.01em;
  }
  .nav-links {
    display: flex;
    gap: 4px;
  }
  .nav-link {
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 0.875rem;
    color: var(--muted);
    transition: color 0.15s, background 0.15s;
  }
  .nav-link:hover {
    color: var(--text);
    background: var(--border);
  }
  .nav-link.active {
    color: var(--text);
    background: var(--border);
  }
  .page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 32px 24px;
  }
`;

export default function App() {
  return (
    <BrowserRouter>
      <style>{NAV_STYLES}</style>
      <nav className="nav">
        <NavLink to="/" className="nav-brand">StudySpace IoT</NavLink>
        <div className="nav-links">
          <NavLink to="/"          className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} end>Rooms</NavLink>
          <NavLink to="/anomalies" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Anomalies</NavLink>
          <NavLink to="/insights"  className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Insights</NavLink>
          <NavLink to="/settings"  className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Settings</NavLink>
        </div>
      </nav>
      <div className="page">
        <Routes>
          <Route path="/"                                   element={<RoomList />} />
          <Route path="/rooms/:room_id"                     element={<RoomDetail />} />
          <Route path="/rooms/:room_id/metrics/:metric"     element={<MetricDetail />} />
          <Route path="/anomalies"                          element={<Anomalies />} />
          <Route path="/insights"                           element={<Insights />} />
          <Route path="/settings"                           element={<Settings />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
