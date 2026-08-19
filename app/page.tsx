'use client';

import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { StatusDot, type Status } from '@/components/StatusDot';
import { useApi } from '@/components/useApi';

interface TransportStatus {
  transport: 'ipv4' | 'ipv6' | 'tor';
  ok: boolean | null;
  latencyMs: number | null;
  lastTs: number | null;
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
}

interface FleetServer {
  id: string;
  name: string;
  kind: 'smp' | 'xftp';
  host: string;
  transports: TransportStatus[];
  certNotAfter: number | null;
  certDaysLeft: number | null;
  openIncidents: number;
}

const TRANSPORT_LABELS: Record<string, string> = { ipv4: 'IPv4', ipv6: 'IPv6', tor: 'Tor' };

function transportStatus(t: TransportStatus): Status {
  if (t.ok === null) return 'nodata';
  return t.ok ? 'up' : 'down';
}

function serverStatus(s: FleetServer): Status {
  const known = s.transports.filter((t) => t.ok !== null);
  if (known.length === 0) return 'nodata';
  const down = known.filter((t) => !t.ok).length;
  if (down === 0) return 'up';
  if (down === known.length) return 'down';
  return 'degraded';
}

function pct(v: number | null): string {
  return v === null ? '–' : `${v >= 99.995 ? '100' : v.toFixed(2)}%`;
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </div>
      <div className="text-2xl font-semibold" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

function ServerCard({ server }: { server: FleetServer }) {
  const status = serverStatus(server);
  const certWarn = server.certDaysLeft !== null && server.certDaysLeft < 14;
  return (
    <Link
      href={`/servers/${server.id}`}
      className="card block p-4 transition-shadow hover:shadow-md"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase"
            style={{
              background: 'var(--page)',
              color: 'var(--ink-muted)',
              border: '1px solid var(--border)',
            }}
          >
            {server.kind}
          </span>
          <span className="font-medium">{server.name}</span>
        </div>
        <StatusDot status={status} />
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {server.transports.map((t) => (
          <div
            key={t.transport}
            className="rounded-md px-2 py-1.5"
            style={{ background: 'var(--page)' }}
          >
            <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {TRANSPORT_LABELS[t.transport]}
            </div>
            <div className="flex items-baseline justify-between">
              <StatusDot
                status={transportStatus(t)}
                label={t.ok === null ? '–' : t.ok ? 'up' : 'down'}
              />
              <span className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
                {t.ok && t.latencyMs !== null ? `${(t.latencyMs / 1000).toFixed(1)}s` : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div
        className="flex items-center justify-between text-xs"
        style={{ color: 'var(--ink-muted)' }}
      >
        <span className="tabular">
          24h {pct(avgUptime(server, 'uptime24h'))} · 30d {pct(avgUptime(server, 'uptime30d'))}
        </span>
        <span style={certWarn ? { color: 'var(--status-critical)', fontWeight: 600 } : undefined}>
          {server.certDaysLeft === null
            ? 'cert: –'
            : server.certDaysLeft > 3650
              ? 'cert: ok'
              : `cert: ${server.certDaysLeft}d`}
          {certWarn ? ' ⚠' : ''}
        </span>
      </div>
    </Link>
  );
}

function avgUptime(s: FleetServer, key: 'uptime24h' | 'uptime30d'): number | null {
  const values = s.transports.map((t) => t[key]).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return Math.min(...values);
}

export default function FleetPage() {
  const { data, error, loading } = useApi<{ servers: FleetServer[] }>('/api/fleet', 30000);
  const servers = data?.servers ?? [];
  const up = servers.filter((s) => serverStatus(s) === 'up').length;
  const problems = servers.filter((s) => ['down', 'degraded'].includes(serverStatus(s)));
  const openIncidents = servers.reduce((acc, s) => acc + s.openIncidents, 0);
  const minCert = servers.reduce<number | null>(
    (acc, s) =>
      s.certDaysLeft === null ? acc : acc === null ? s.certDaysLeft : Math.min(acc, s.certDaysLeft),
    null,
  );

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Servers up"
            value={loading ? '…' : `${up}/${servers.length}`}
            tone={up === servers.length && servers.length > 0 ? 'var(--status-good)' : undefined}
          />
          <StatTile
            label="With problems"
            value={loading ? '…' : String(problems.length)}
            tone={problems.length > 0 ? 'var(--status-critical)' : undefined}
          />
          <StatTile
            label="Open incidents"
            value={loading ? '…' : String(openIncidents)}
            tone={openIncidents > 0 ? 'var(--status-critical)' : undefined}
          />
          <StatTile
            label="Nearest cert expiry"
            value={loading || minCert === null ? '…' : minCert > 3650 ? 'ok' : `${minCert}d`}
            tone={minCert !== null && minCert < 14 ? 'var(--status-critical)' : undefined}
          />
        </div>

        {error && (
          <div className="card p-4 text-sm" style={{ color: 'var(--status-critical)' }}>
            {error}
          </div>
        )}

        <section>
          <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
            SMP servers
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {servers
              .filter((s) => s.kind === 'smp')
              .map((s) => (
                <ServerCard key={s.id} server={s} />
              ))}
          </div>
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
            XFTP servers
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {servers
              .filter((s) => s.kind === 'xftp')
              .map((s) => (
                <ServerCard key={s.id} server={s} />
              ))}
          </div>
        </section>
      </main>
    </>
  );
}
