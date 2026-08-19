import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { appConfig } from './config';
import type { AuditRow, CertRow, IncidentRow, ProbeRow, Transport } from './types';

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS probes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  transport TEXT NOT NULL,
  ts INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  latency_ms REAL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_probes_lookup ON probes (server_id, transport, ts);
CREATE INDEX IF NOT EXISTS idx_probes_ts ON probes (ts);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  transport TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_incidents_open ON incidents (server_id, transport, ended_at);

CREATE TABLE IF NOT EXISTS certs (
  server_id TEXT PRIMARY KEY,
  checked_at INTEGER NOT NULL,
  not_after INTEGER,
  issuer TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS otp_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS login_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_events ON login_events (email, ts);
CREATE INDEX IF NOT EXISTS idx_login_events_ip ON login_events (ip, ts);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  server_id TEXT,
  action TEXT NOT NULL,
  ts INTEGER NOT NULL,
  result TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts);
`;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = path.resolve(process.cwd(), appConfig.databasePath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

// --- probes ---

export function insertProbe(p: {
  serverId: string;
  transport: Transport;
  ts: number;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}): void {
  getDb()
    .prepare(
      'INSERT INTO probes (server_id, transport, ts, ok, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(p.serverId, p.transport, p.ts, p.ok ? 1 : 0, p.latencyMs, p.error);
}

export function getProbes(serverId: string, transport: Transport, sinceTs: number): ProbeRow[] {
  return getDb()
    .prepare(
      'SELECT server_id, transport, ts, ok, latency_ms, error FROM probes WHERE server_id = ? AND transport = ? AND ts >= ? ORDER BY ts ASC',
    )
    .all(serverId, transport, sinceTs) as ProbeRow[];
}

export function getLatestProbe(serverId: string, transport: Transport): ProbeRow | undefined {
  return getDb()
    .prepare(
      'SELECT server_id, transport, ts, ok, latency_ms, error FROM probes WHERE server_id = ? AND transport = ? ORDER BY ts DESC LIMIT 1',
    )
    .get(serverId, transport) as ProbeRow | undefined;
}

export function getUptimeCounts(
  serverId: string,
  transport: Transport,
  sinceTs: number,
): { total: number; up: number } {
  const row = getDb()
    .prepare(
      'SELECT COUNT(*) AS total, COALESCE(SUM(ok), 0) AS up FROM probes WHERE server_id = ? AND transport = ? AND ts >= ?',
    )
    .get(serverId, transport, sinceTs) as { total: number; up: number };
  return row;
}

export function getRecentFails(serverId: string, transport: Transport, limit: number): ProbeRow[] {
  return getDb()
    .prepare(
      'SELECT server_id, transport, ts, ok, latency_ms, error FROM probes WHERE server_id = ? AND transport = ? ORDER BY ts DESC LIMIT ?',
    )
    .all(serverId, transport, limit) as ProbeRow[];
}

export function pruneProbes(beforeTs: number): number {
  const res = getDb().prepare('DELETE FROM probes WHERE ts < ?').run(beforeTs);
  return res.changes;
}

// --- incidents ---

export function getOpenIncident(serverId: string, transport: Transport): IncidentRow | undefined {
  return getDb()
    .prepare(
      'SELECT * FROM incidents WHERE server_id = ? AND transport = ? AND ended_at IS NULL LIMIT 1',
    )
    .get(serverId, transport) as IncidentRow | undefined;
}

export function openIncident(
  serverId: string,
  transport: Transport,
  startedAt: number,
  failCount: number,
): number {
  const res = getDb()
    .prepare(
      'INSERT INTO incidents (server_id, transport, started_at, fail_count) VALUES (?, ?, ?, ?)',
    )
    .run(serverId, transport, startedAt, failCount);
  return Number(res.lastInsertRowid);
}

export function bumpIncidentFailCount(id: number): void {
  getDb().prepare('UPDATE incidents SET fail_count = fail_count + 1 WHERE id = ?').run(id);
}

export function closeIncident(id: number, endedAt: number): void {
  getDb().prepare('UPDATE incidents SET ended_at = ? WHERE id = ?').run(endedAt, id);
}

export function listIncidents(limit: number, serverId?: string): IncidentRow[] {
  if (serverId) {
    return getDb()
      .prepare('SELECT * FROM incidents WHERE server_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(serverId, limit) as IncidentRow[];
  }
  return getDb()
    .prepare('SELECT * FROM incidents ORDER BY started_at DESC LIMIT ?')
    .all(limit) as IncidentRow[];
}

export function countOpenIncidents(serverId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM incidents WHERE server_id = ? AND ended_at IS NULL')
    .get(serverId) as { n: number };
  return row.n;
}

// --- certs ---

export function upsertCert(c: CertRow): void {
  getDb()
    .prepare(
      `INSERT INTO certs (server_id, checked_at, not_after, issuer, error) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(server_id) DO UPDATE SET checked_at = excluded.checked_at, not_after = excluded.not_after, issuer = excluded.issuer, error = excluded.error`,
    )
    .run(c.server_id, c.checked_at, c.not_after, c.issuer, c.error);
}

export function getCert(serverId: string): CertRow | undefined {
  return getDb().prepare('SELECT * FROM certs WHERE server_id = ?').get(serverId) as
    CertRow | undefined;
}

// --- OTP / login rate limiting ---

export function saveOtp(email: string, codeHash: string, expiresAt: number): void {
  getDb()
    .prepare(
      `INSERT INTO otp_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`,
    )
    .run(email, codeHash, expiresAt);
}

export function getOtp(
  email: string,
): { code_hash: string; expires_at: number; attempts: number } | undefined {
  return getDb()
    .prepare('SELECT code_hash, expires_at, attempts FROM otp_codes WHERE email = ?')
    .get(email) as { code_hash: string; expires_at: number; attempts: number } | undefined;
}

export function bumpOtpAttempts(email: string): void {
  getDb().prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ?').run(email);
}

export function deleteOtp(email: string): void {
  getDb().prepare('DELETE FROM otp_codes WHERE email = ?').run(email);
}

export function recordLoginEvent(email: string, ip: string, kind: string): void {
  getDb()
    .prepare('INSERT INTO login_events (email, ip, ts, kind) VALUES (?, ?, ?, ?)')
    .run(email, ip, Date.now(), kind);
}

export function countLoginEvents(opts: {
  email?: string;
  ip?: string;
  kind: string;
  sinceTs: number;
}): number {
  if (opts.email !== undefined) {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS n FROM login_events WHERE email = ? AND kind = ? AND ts >= ?')
      .get(opts.email, opts.kind, opts.sinceTs) as { n: number };
    return row.n;
  }
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM login_events WHERE ip = ? AND kind = ? AND ts >= ?')
    .get(opts.ip, opts.kind, opts.sinceTs) as { n: number };
  return row.n;
}

// --- audit ---

export function recordAudit(
  email: string,
  serverId: string | null,
  action: string,
  result: string,
): void {
  getDb()
    .prepare('INSERT INTO audit_log (email, server_id, action, ts, result) VALUES (?, ?, ?, ?, ?)')
    .run(email, serverId, action, Date.now(), result);
}

export function listAudit(limit: number): AuditRow[] {
  return getDb()
    .prepare('SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?')
    .all(limit) as AuditRow[];
}
