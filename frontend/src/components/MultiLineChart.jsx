import React from 'react';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-RW', {
    timeZone: 'Africa/Kigali',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

const LINES = [
  { key: 'temperature',       label: 'Temperature', unit: '°C',      color: '#f97316', yAxis: 'left'   },
  { key: 'humidity',          label: 'Humidity',    unit: '%',        color: '#3b82f6', yAxis: 'left'   },
  { key: 'sound_db',          label: 'Sound',       unit: 'dB',       color: '#a855f7', yAxis: 'right'  },
  { key: 'light_lux',         label: 'Light',       unit: 'lux',      color: '#eab308', yAxis: 'right'  },
  { key: 'movements_per_min', label: 'Motion',      unit: 'mov/min',  color: '#22c55e', yAxis: 'motion' },
];

const CHART_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '16px 8px 8px',
};

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#1e2130',
      border: '1px solid #2a2d3e',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: '0.8rem',
    }}>
      <p style={{ color: '#64748b', marginBottom: 6 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color, margin: '2px 0' }}>
          {p.name}: {p.value?.toFixed(1)} {LINES.find(l => l.key === p.dataKey)?.unit ?? ''}
        </p>
      ))}
    </div>
  );
}

function CustomLegend({ payload }) {
  return (
    <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
      {payload.map(entry => {
        const meta = LINES.find(l => l.key === entry.dataKey);
        return (
          <span key={entry.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: '#64748b' }}>
            <span style={{ width: 12, height: 2, background: entry.color, display: 'inline-block', borderRadius: 1 }} />
            {meta?.label} ({meta?.unit})
          </span>
        );
      })}
    </div>
  );
}

export default function MultiLineChart({ data = [], height = 420 }) {
  if (!data.length) return null;

  return (
    <div style={CHART_STYLE}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 20, left: 20, bottom: 0 }}>
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
            yAxisId="left"
            domain={[0, 100]}
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={{ stroke: '#2a2d3e' }}
            tickLine={false}
            width={54}
            label={{ value: '°C / %', angle: -90, position: 'insideRight', offset: 0, fill: '#64748b', fontSize: 11 }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={{ stroke: '#2a2d3e' }}
            tickLine={false}
            width={70}
            label={{ value: 'dB/lux', angle: -90, position: 'insideLeft', offset: 0, fill: '#64748b', fontSize: 11 }}
          />
          <YAxis
            yAxisId="motion"
            orientation="right"
            tick={{ fill: '#22c55e', fontSize: 11 }}
            axisLine={{ stroke: '#2a2d3e' }}
            tickLine={false}
            width={54}
            label={{ value: 'mov/min', angle: -90, position: 'insideLeft', offset: 0, fill: '#22c55e', fontSize: 11 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend content={<CustomLegend />} />
          {LINES.map(({ key, color, yAxis }) => (
            <Line
              key={key}
              yAxisId={yAxis}
              type="monotone"
              dataKey={key}
              stroke={color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
