'use client';

import { use, useState } from 'react';
import { Nav } from '@/components/Nav';
import { StatusDot } from '@/components/StatusDot';
import { TimeSeriesChart } from '@/components/TimeSeriesChart';
import { UptimeBar, type DayBucketView } from '@/components/UptimeBar';
import { apiFetch, useApi } from '@/components/useApi';

type Transport = 'ipv4' | 'ipv6' | 'tor';
const TRANSPORTS: Transport[] = ['ipv4', 'ipv6', 'tor'];
const TRANSPORT_LABELS: Record<Transport, string> = { ipv4: 'IPv4', ipv6: 'IPv6', tor: 'Tor' };
const TRANSPORT_COLORS: Record<Transport, string> = {
  ipv4: 'var(--series-1)',
  ipv6: 'var(--series-2)',
  tor: 'var(--series-3)',
};

interface HistoryPoint {
  ts: number;
  ok: boolean;
  latencyMs: number | null;
}
interface IncidentRow {
  id: number;
  server_id: string;
  transport: Transport;
  started_at: number;
  ended_at: number | null;
  fail_count: number;
}
interface HistoryResponse {
  history: {
    transports: Record<Transport, HistoryPoint[]>;
    buckets90d: Record<Transport, DayBucketView[]>;
  };
  incidents: IncidentRow[];
}
interface ChartMeta {
  id: string;
  title: string;
  unit: string;
  seriesLabels: string[];
}
interface MetricsCatalog {
  enabled: boolean;
  charts: ChartMeta[];
  version: string | null;
}
interface ChartData {
  enabled: boolean;
  chart: { id: string; title: string; unit: string };
  series: { label: string; points: { ts: number; value: number | null }[] }[];
}

const RANGES = ['6h', '24h', '7d', '30d'] as const;
const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

function duration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ${min % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

type RestartTarget = 'simplex' | 'tor';

function stateColor(state: string): string {
  return state === 'active' ? 'var(--status-good)' : 'var(--status-critical)';
}

function RestartPanel({ serverId }: { serverId: string }) {
  const [confirming, setConfirming] = useState<RestartTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { data: status } = useApi<{ unitState: string; torState: string }>(
    `/api/servers/${serverId}/status`,
    60000,
  );

  const restart = async (service: RestartTarget) => {
    setBusy(true);
    setResult(null);
    try {
      const res = await apiFetch<{ restarted: boolean; unitState: string }>(
        `/api/servers/${serverId}/restart`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service }),
        },
      );
      setResult(`Restarted ${service === 'tor' ? 'Tor' : 'service'}. State: ${res.unitState}`);
    } catch (e) {
      setResult(`Restart failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {status && (
        <span className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          unit:{' '}
          <span style={{ color: stateColor(status.unitState), fontWeight: 600 }}>
            {status.unitState}
          </span>
          {' · tor: '}
          <span style={{ color: stateColor(status.torState), fontWeight: 600 }}>
            {status.torState}
          </span>
        </span>
      )}
      {confirming ? (
        <span className="flex items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--ink-2)' }}>
            Restart {confirming === 'tor' ? 'Tor' : 'the service'}?
          </span>
          <button
            onClick={() => restart(confirming)}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--status-critical)', color: '#fff' }}
          >
            {busy ? 'Restarting…' : 'Yes, restart'}
          </button>
          <button
            onClick={() => setConfirming(null)}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}
          >
            Cancel
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <button
            onClick={() => setConfirming('simplex')}
            className="rounded-md px-3 py-1.5 text-sm font-medium"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent-bg-ink)' }}
          >
            Restart service
          </button>
          <button
            onClick={() => setConfirming('tor')}
            className="rounded-md border px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}
          >
            Restart Tor
          </button>
        </span>
      )}
      {result && (
        <span className="text-sm" style={{ color: 'var(--ink-2)' }}>
          {result}
        </span>
      )}
    </div>
  );
}

function LogsPanel({ serverId }: { serverId: string }) {
  const [logs, setLogs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ logs: string }>(`/api/servers/${serverId}/logs`);
      setLogs(res.logs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
          Journal (last 200 lines)
        </h3>
        <button
          onClick={load}
          disabled={busy}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-60"
          style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}
        >
          {busy ? 'Loading…' : logs ? 'Refresh' : 'Load logs'}
        </button>
      </div>
      {error && (
        <p className="text-sm" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}
      {logs !== null && (
        <pre
          className="max-h-96 overflow-auto rounded-md p-3 text-xs leading-relaxed"
          style={{ background: 'var(--page)', color: 'var(--ink-2)' }}
        >
          {logs || '(empty)'}
        </pre>
      )}
    </div>
  );
}

function MetricChartCard({
  serverId,
  chart,
  range,
}: {
  serverId: string;
  chart: ChartMeta;
  range: string;
}) {
  const { data, error } = useApi<ChartData>(
    `/api/servers/${serverId}/metrics?chart=${chart.id}&range=${range}`,
    120000,
  );
  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
        {chart.title}
      </h3>
      {error ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          {error}
        </p>
      ) : (
        <TimeSeriesChart
          unit={chart.unit}
          series={(data?.series ?? []).map((s, i) => ({
            label: s.label,
            color: SERIES_COLORS[i % SERIES_COLORS.length] ?? 'var(--series-1)',
            points: s.points,
          }))}
        />
      )}
    </div>
  );
}

export default function ServerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [range, setRange] = useState<(typeof RANGES)[number]>('24h');
  const { data: hist, error } = useApi<HistoryResponse>(
    `/api/servers/${id}/history?range=${range}`,
    60000,
  );
  const { data: catalog } = useApi<MetricsCatalog>(`/api/servers/${id}/metrics`, 300000);

  const latencySeries = TRANSPORTS.map((t) => ({
    label: TRANSPORT_LABELS[t],
    color: TRANSPORT_COLORS[t],
    points: (hist?.history.transports[t] ?? []).map((p) => ({
      ts: p.ts,
      value: p.ok ? p.latencyMs : null,
    })),
  }));

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">
            {id}
            {catalog?.version && (
              <span className="ml-2 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
                v{catalog.version}
              </span>
            )}
          </h1>
          <RestartPanel serverId={id} />
        </div>

        {error && (
          <div className="card p-4 text-sm" style={{ color: 'var(--status-critical)' }}>
            {error}
          </div>
        )}

        <div className="card space-y-3 p-4">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
            90-day uptime by transport
          </h3>
          {TRANSPORTS.map((t) => (
            <div key={t}>
              <div
                className="mb-1 flex items-center gap-2 text-xs"
                style={{ color: 'var(--ink-muted)' }}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: TRANSPORT_COLORS[t] }}
                  aria-hidden
                />
                {TRANSPORT_LABELS[t]}
              </div>
              <UptimeBar buckets={hist?.history.buckets90d[t] ?? []} />
            </div>
          ))}
        </div>

        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
              Check latency (full protocol test, includes CLI startup)
            </h3>
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className="rounded-md px-2 py-1 text-xs"
                  style={
                    r === range
                      ? {
                          background: 'var(--accent-bg)',
                          color: 'var(--accent-bg-ink)',
                          fontWeight: 600,
                        }
                      : { color: 'var(--ink-muted)' }
                  }
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <TimeSeriesChart unit="ms" series={latencySeries} />
        </div>

        {catalog?.enabled && (
          <div className="grid gap-4 lg:grid-cols-2">
            {catalog.charts.map((c) => (
              <MetricChartCard key={c.id} serverId={id} chart={c} range={range} />
            ))}
          </div>
        )}

        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
            Recent incidents
          </h3>
          {(hist?.incidents ?? []).length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
              No incidents recorded.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(hist?.incidents ?? []).map((inc) => (
                <li key={inc.id} className="flex flex-wrap items-center gap-2">
                  <StatusDot
                    status={inc.ended_at === null ? 'down' : 'up'}
                    label={inc.ended_at === null ? 'ongoing' : 'resolved'}
                  />
                  <span>{TRANSPORT_LABELS[inc.transport]}</span>
                  <span style={{ color: 'var(--ink-muted)' }}>
                    {new Date(inc.started_at).toLocaleString()}
                    {inc.ended_at !== null &&
                      ` · lasted ${duration(inc.ended_at - inc.started_at)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <LogsPanel serverId={id} />
      </main>
    </>
  );
}
