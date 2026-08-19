export type ServerKind = 'smp' | 'xftp';
export type Transport = 'ipv4' | 'ipv6' | 'tor';

export const TRANSPORTS: Transport[] = ['ipv4', 'ipv6', 'tor'];

export interface ServerConfig {
  id: string;
  name: string;
  kind: ServerKind;
  host: string;
  port: number;
  fingerprint: string;
  onion: string;
  ssh: { host: string; user: string; port: number };
}

export interface ProbeResult {
  serverId: string;
  transport: Transport;
  ts: number;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface ProbeRow {
  server_id: string;
  transport: Transport;
  ts: number;
  ok: 0 | 1;
  latency_ms: number | null;
  error: string | null;
}

export interface IncidentRow {
  id: number;
  server_id: string;
  transport: Transport;
  started_at: number;
  ended_at: number | null;
  fail_count: number;
}

export interface CertRow {
  server_id: string;
  checked_at: number;
  not_after: number | null;
  issuer: string | null;
  error: string | null;
}

export interface AuditRow {
  id: number;
  email: string;
  server_id: string | null;
  action: string;
  ts: number;
  result: string;
}

export interface TransportStatus {
  transport: Transport;
  ok: boolean | null; // null = no data yet (e.g. IPv6 probing disabled)
  latencyMs: number | null;
  lastTs: number | null;
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
}

export interface FleetServer {
  id: string;
  name: string;
  kind: ServerKind;
  host: string;
  transports: TransportStatus[];
  certNotAfter: number | null;
  certDaysLeft: number | null;
  openIncidents: number;
}
