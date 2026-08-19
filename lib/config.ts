import fs from 'node:fs';
import path from 'node:path';
import type { ServerConfig } from './types';

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be an integer`);
  return n;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

let serversCache: ServerConfig[] | null = null;

export function loadServers(): ServerConfig[] {
  if (serversCache) return serversCache;
  const file = path.join(process.cwd(), 'config', 'servers.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { servers: ServerConfig[] };
  if (!Array.isArray(parsed.servers) || parsed.servers.length === 0) {
    throw new Error('config/servers.json contains no servers');
  }
  for (const s of parsed.servers) {
    for (const field of ['id', 'name', 'kind', 'host', 'fingerprint', 'onion'] as const) {
      if (!s[field]) throw new Error(`Server entry missing field "${field}"`);
    }
  }
  serversCache = parsed.servers;
  return serversCache;
}

export function getServer(id: string): ServerConfig | undefined {
  return loadServers().find((s) => s.id === id);
}

export const appConfig = {
  get databasePath() {
    return env('DATABASE_PATH', './data/monitor.db');
  },
  get allowedEmails(): string[] {
    return env('ALLOWED_EMAILS', '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  get sessionSecret() {
    return env('SESSION_SECRET');
  },
  get sessionDays() {
    return envInt('SESSION_DAYS', 7);
  },
  /** SMTP is optional: without it, login codes are issued via `yarn issue-code`. */
  get smtpConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  },
  get smtp() {
    return {
      host: env('SMTP_HOST'),
      port: envInt('SMTP_PORT', 465),
      secure: envBool('SMTP_SECURE', true),
      user: env('SMTP_USER'),
      pass: env('SMTP_PASS'),
      from: env('SMTP_FROM', env('SMTP_USER')),
    };
  },
  get alertEmails(): string[] {
    return env('ALERT_EMAILS', '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
  },
  get prober() {
    return {
      simplexChatBin: env('SIMPLEX_CHAT_BIN', '/usr/local/bin/simplex-chat'),
      probeDbDir: env('PROBE_DB_DIR', './data/probe-profiles'),
      intervalSec: envInt('PROBE_INTERVAL', 180),
      timeoutSec: envInt('PROBE_TIMEOUT', 60),
      failThreshold: envInt('PROBE_FAIL_THRESHOLD', 2),
      torSocks: env('TOR_SOCKS', '127.0.0.1:9050'),
      retentionDays: envInt('PROBE_RETENTION_DAYS', 90),
      certWarnDays: envInt('CERT_WARN_DAYS', 14),
      ipv6Enabled: envBool('PROBE_IPV6', true),
    };
  },
  get prometheusUrl(): string | null {
    const v = process.env.PROMETHEUS_URL;
    return v && v !== '' ? v.replace(/\/$/, '') : null;
  },
  get ssh() {
    return {
      keyPath: env('SSH_KEY_PATH', ''),
      timeoutSec: envInt('SSH_TIMEOUT', 20),
    };
  },
};
