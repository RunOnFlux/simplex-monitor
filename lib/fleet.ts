import { appConfig, loadServers } from './config';
import { countOpenIncidents, getCert, getLatestProbe, getProbes, getUptimeCounts } from './db';
import { TRANSPORTS, type FleetServer, type Transport, type TransportStatus } from './types';
import { certDaysLeft, dailyBuckets, uptimePercent, type DayBucket } from './uptime';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function transportStatus(serverId: string, transport: Transport, now: number): TransportStatus {
  const latest = getLatestProbe(serverId, transport);
  // A probe older than 3 cycles means the lane is stale (e.g. IPv6 disabled).
  const staleAfter = appConfig.prober.intervalSec * 1000 * 3;
  const fresh = latest !== undefined && now - latest.ts < staleAfter;
  return {
    transport,
    ok: fresh ? latest.ok === 1 : null,
    latencyMs: fresh ? latest.latency_ms : null,
    lastTs: latest?.ts ?? null,
    uptime24h: uptimePercent(getUptimeCounts(serverId, transport, now - DAY)),
    uptime7d: uptimePercent(getUptimeCounts(serverId, transport, now - 7 * DAY)),
    uptime30d: uptimePercent(getUptimeCounts(serverId, transport, now - 30 * DAY)),
  };
}

export function buildFleet(): FleetServer[] {
  const now = Date.now();
  return loadServers().map((server) => {
    const cert = getCert(server.id);
    return {
      id: server.id,
      name: server.name,
      kind: server.kind,
      host: server.host,
      transports: TRANSPORTS.map((t) => transportStatus(server.id, t, now)),
      certNotAfter: cert?.not_after ?? null,
      certDaysLeft: certDaysLeft(cert?.not_after ?? null, now),
      openIncidents: countOpenIncidents(server.id),
    };
  });
}

export interface HistoryPoint {
  ts: number;
  ok: boolean;
  latencyMs: number | null;
}

export interface ServerHistory {
  transports: Record<Transport, HistoryPoint[]>;
  buckets90d: Record<Transport, DayBucket[]>;
}

export function buildHistory(serverId: string, rangeMs: number): ServerHistory {
  const now = Date.now();
  const transports = {} as Record<Transport, HistoryPoint[]>;
  const buckets90d = {} as Record<Transport, DayBucket[]>;
  for (const t of TRANSPORTS) {
    transports[t] = getProbes(serverId, t, now - rangeMs).map((p) => ({
      ts: p.ts,
      ok: p.ok === 1,
      latencyMs: p.latency_ms,
    }));
    buckets90d[t] = dailyBuckets(getProbes(serverId, t, now - 90 * DAY), 90, now);
  }
  return { transports, buckets90d };
}
