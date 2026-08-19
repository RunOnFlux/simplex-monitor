import { appConfig } from './config';
import type { ServerKind } from './types';

export interface ChartSeriesDef {
  label: string;
  /** PromQL with SERVER placeholder substituted by the server id label */
  query: string;
}

export interface ChartDef {
  id: string;
  title: string;
  /** display unit: 'count', 'per_second', 'percent', 'bytes' */
  unit: 'count' | 'per_second' | 'percent' | 'bytes';
  series: ChartSeriesDef[];
}

const SMP_CHARTS: ChartDef[] = [
  {
    id: 'messages',
    title: 'Message throughput',
    unit: 'per_second',
    series: [
      { label: 'Sent', query: 'rate(simplex_smp_messages_sent{server="SERVER"}[15m])' },
      { label: 'Delivered', query: 'rate(simplex_smp_messages_received{server="SERVER"}[15m])' },
    ],
  },
  {
    id: 'clients',
    title: 'Connected clients',
    unit: 'count',
    series: [{ label: 'Clients', query: 'simplex_smp_clients_total{server="SERVER"}' }],
  },
  {
    id: 'queues',
    title: 'Queues',
    unit: 'count',
    series: [
      { label: 'Stored', query: 'simplex_smp_queues_total1{server="SERVER"}' },
      { label: 'Daily active', query: 'simplex_smp_queues_daily{server="SERVER"}' },
    ],
  },
];

const XFTP_CHARTS: ChartDef[] = [
  {
    id: 'files',
    title: 'File activity',
    unit: 'per_second',
    series: [
      { label: 'Uploads', query: 'rate(simplex_xftp_files_uploaded{server="SERVER"}[15m])' },
      { label: 'Downloads', query: 'rate(simplex_xftp_file_downloads{server="SERVER"}[15m])' },
    ],
  },
  {
    id: 'storage',
    title: 'Stored files size',
    unit: 'bytes',
    series: [{ label: 'Size', query: 'simplex_xftp_files_size{server="SERVER"}' }],
  },
];

const HOST_CHARTS: ChartDef[] = [
  {
    id: 'cpu',
    title: 'Host CPU usage (% of all cores)',
    unit: 'percent',
    series: [
      {
        label: 'CPU busy',
        query: '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle",server="SERVER"}[5m])))',
      },
    ],
  },
  {
    id: 'memory',
    title: 'Host memory',
    unit: 'bytes',
    series: [
      {
        label: 'Used',
        query:
          'node_memory_MemTotal_bytes{server="SERVER"} - node_memory_MemAvailable_bytes{server="SERVER"}',
      },
      { label: 'Total', query: 'node_memory_MemTotal_bytes{server="SERVER"}' },
    ],
  },
  {
    id: 'disk',
    title: 'Host disk (/)',
    unit: 'bytes',
    series: [
      {
        label: 'Used',
        query:
          'node_filesystem_size_bytes{server="SERVER",mountpoint="/"} - node_filesystem_avail_bytes{server="SERVER",mountpoint="/"}',
      },
      { label: 'Total', query: 'node_filesystem_size_bytes{server="SERVER",mountpoint="/"}' },
    ],
  },
];

/** Root-filesystem usage percent for every server, keyed by the `server` label. */
export const DISK_USAGE_QUERY =
  'max by (server) (100 * (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}))';

export interface InstantSample {
  labels: Record<string, string>;
  value: number;
}

interface PromVectorResponse {
  status: string;
  data?: { result?: { metric?: Record<string, string>; value?: [number, string] }[] };
}

export async function queryInstant(query: string): Promise<InstantSample[]> {
  const base = appConfig.prometheusUrl;
  if (!base) return [];
  const url = new URL(`${base}/api/v1/query`);
  url.searchParams.set('query', query);
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Prometheus responded ${res.status}`);
  const body = (await res.json()) as PromVectorResponse;
  if (body.status !== 'success') throw new Error('Prometheus query failed');
  return (body.data?.result ?? [])
    .map((r) => ({
      labels: r.metric ?? {},
      value: Number.parseFloat(r.value?.[1] ?? 'NaN'),
    }))
    .filter((s) => Number.isFinite(s.value));
}

export function chartsForKind(kind: ServerKind): ChartDef[] {
  return [...(kind === 'smp' ? SMP_CHARTS : XFTP_CHARTS), ...HOST_CHARTS];
}

export function getChart(kind: ServerKind, chartId: string): ChartDef | undefined {
  return chartsForKind(kind).find((c) => c.id === chartId);
}

export interface MetricPoint {
  ts: number;
  value: number | null;
}

export interface MetricSeries {
  label: string;
  points: MetricPoint[];
}

interface PromRangeResponse {
  status: string;
  data?: { result?: { values?: [number, string][] }[] };
}

export async function queryRange(
  query: string,
  startSec: number,
  endSec: number,
  stepSec: number,
): Promise<MetricPoint[]> {
  const base = appConfig.prometheusUrl;
  if (!base) throw new Error('PROMETHEUS_URL is not configured');
  const url = new URL(`${base}/api/v1/query_range`);
  url.searchParams.set('query', query);
  url.searchParams.set('start', String(startSec));
  url.searchParams.set('end', String(endSec));
  url.searchParams.set('step', String(stepSec));
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Prometheus responded ${res.status}`);
  const body = (await res.json()) as PromRangeResponse;
  if (body.status !== 'success') throw new Error('Prometheus query failed');
  const values = body.data?.result?.[0]?.values ?? [];
  return values.map(([ts, v]) => {
    const n = Number.parseFloat(v);
    return { ts: ts * 1000, value: Number.isFinite(n) ? n : null };
  });
}

interface PromInstantResponse {
  status: string;
  data?: { result?: { metric?: Record<string, string> }[] };
}

/** Reads the server software version from the simplex_*_info metric, if Prometheus is configured. */
export async function getServerVersion(kind: ServerKind, serverId: string): Promise<string | null> {
  const base = appConfig.prometheusUrl;
  if (!base) return null;
  const metric = kind === 'smp' ? 'simplex_smp_info' : 'simplex_xftp_info';
  const url = new URL(`${base}/api/v1/query`);
  url.searchParams.set('query', `${metric}{server="${serverId}"}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const body = (await res.json()) as PromInstantResponse;
    return body.data?.result?.[0]?.metric?.version ?? null;
  } catch {
    return null;
  }
}
