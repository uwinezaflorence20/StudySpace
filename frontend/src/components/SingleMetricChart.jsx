import React from 'react';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-RW', {
    timeZone: 'Africa/Kigali',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function CustomTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#1e2130',
      border: '1px solid #2a2d3e',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: '0.8rem',
    }}>
      <p style={{ color: '#64748b', marginBottom: 4 }}>{label}</p>
      <p style={{ color: payload[0].color }}>
        {payload[0].value?.toFixed(2)} {unit}
      </p>
    </div>
  );
}

export default function SingleMetricChart({ data = [], metric, unit = '', color = '#6366f1', height = 280 }) {
  if (!data.length) return null;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '16px 8px 8px',
    }}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#2a2d3e" strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatTime}
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={{ stroke: '#2a2d3e' }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={{ stroke: '#2a2d3e' }}
            tickLine={false}
            label={{ value: unit, angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11, dy: 20 }}
          />
          <Tooltip content={<CustomTooltip unit={unit} />} />
          <Line
            type="monotone"
            dataKey={metric}
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
