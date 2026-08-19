'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ChartSeries {
  label: string;
  color: string; // CSS var reference, e.g. 'var(--series-1)'
  points: { ts: number; value: number | null }[];
}

function formatValue(v: number, unit: string): string {
  if (unit === 'bytes') {
    if (v >= 1024 ** 4) return `${(v / 1024 ** 4).toFixed(2)} TiB`;
    if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GiB`;
    if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MiB`;
    if (v >= 1024) return `${(v / 1024).toFixed(1)} KiB`;
    return `${v.toFixed(0)} B`;
  }
  if (unit === 'percent') return `${v.toFixed(1)}%`;
  if (unit === 'per_second') return v >= 10 ? v.toFixed(1) : v.toFixed(3);
  if (unit === 'ms') return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v.toFixed(0)}ms`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}

function formatTime(ts: number, rangeMs: number): string {
  const d = new Date(ts);
  if (rangeMs > 2 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function TimeSeriesChart({
  series,
  unit,
  height = 220,
}: {
  series: ChartSeries[];
  unit: string;
  height?: number;
}) {
  // Merge series onto one time axis. Timestamps are quantized into shared
  // buckets so series sampled at slightly different moments land on common
  // rows and draw as continuous lines. The bucket must be at least as wide as
  // the sampling interval (median gap), otherwise every series would sit on
  // its own rows with nulls everywhere else and the lines would shatter.
  let minTs = Infinity;
  let maxTs = -Infinity;
  let maxMedianGap = 1;
  for (const s of series) {
    const gaps: number[] = [];
    for (let i = 0; i < s.points.length; i++) {
      const p = s.points[i];
      if (!p) continue;
      if (p.ts < minTs) minTs = p.ts;
      if (p.ts > maxTs) maxTs = p.ts;
      const prev = s.points[i - 1];
      if (prev) gaps.push(p.ts - prev.ts);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median !== undefined && median > maxMedianGap) maxMedianGap = median;
  }
  const bucket = Math.max(1, Math.floor((maxTs - minTs) / 500), maxMedianGap);
  const byTs = new Map<number, Record<string, number | null>>();
  for (const s of series) {
    for (const p of s.points) {
      const ts = Math.round((p.ts - minTs) / bucket) * bucket + minTs;
      const row = byTs.get(ts) ?? {};
      // Keep the worst (highest) value when two samples share a bucket, and
      // let a null (failed check) win so outages stay visible as gaps.
      const prev = row[s.label];
      row[s.label] =
        prev === null ? null : p.value === null ? null : Math.max(prev ?? -Infinity, p.value);
      byTs.set(ts, row);
    }
  }
  const data = [...byTs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, values]) => ({ ts, ...values }));
  const rangeMs = data.length > 1 ? (data[data.length - 1]?.ts ?? 0) - (data[0]?.ts ?? 0) : 0;

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm"
        style={{ height, color: 'var(--ink-muted)' }}
      >
        No data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="ts"
          tickFormatter={(ts: number) => formatTime(ts, rangeMs)}
          stroke="var(--baseline)"
          tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
          tickLine={false}
          minTickGap={48}
        />
        <YAxis
          tickFormatter={(v: number) => formatValue(v, unit)}
          stroke="transparent"
          tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
          tickLine={false}
          width={64}
        />
        <Tooltip
          isAnimationActive={false}
          labelFormatter={(ts) =>
            new Date(Number(ts)).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          }
          formatter={(value) =>
            typeof value === 'number' ? formatValue(value, unit) : String(value)
          }
          contentStyle={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--ink)',
            fontSize: 13,
          }}
        />
        {series.length > 1 && (
          <Legend wrapperStyle={{ fontSize: 13, color: 'var(--ink-2)' }} iconType="plainline" />
        )}
        {series.map((s) => (
          <Line
            key={s.label}
            type="monotone"
            dataKey={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
