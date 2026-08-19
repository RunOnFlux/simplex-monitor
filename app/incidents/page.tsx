'use client';

import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { StatusDot } from '@/components/StatusDot';
import { useApi } from '@/components/useApi';

interface IncidentRow {
  id: number;
  server_id: string;
  transport: 'ipv4' | 'ipv6' | 'tor';
  started_at: number;
  ended_at: number | null;
  fail_count: number;
}

const TRANSPORT_LABELS = { ipv4: 'IPv4', ipv6: 'IPv6', tor: 'Tor' } as const;

function duration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ${min % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export default function IncidentsPage() {
  const { data, error, loading } = useApi<{ incidents: IncidentRow[] }>('/api/incidents', 60000);
  const incidents = data?.incidents ?? [];

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="mb-4 text-xl font-semibold">Incidents</h1>
        {error && (
          <div className="card mb-4 p-4 text-sm" style={{ color: 'var(--status-critical)' }}>
            {error}
          </div>
        )}
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: 'var(--ink-muted)' }}>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Server</th>
                <th className="px-4 py-2 font-medium">Transport</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Duration</th>
                <th className="px-4 py-2 font-medium">Failed checks</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc) => (
                <tr key={inc.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-4 py-2">
                    <StatusDot
                      status={inc.ended_at === null ? 'down' : 'up'}
                      label={inc.ended_at === null ? 'Ongoing' : 'Resolved'}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`/servers/${inc.server_id}`} className="underline">
                      {inc.server_id}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{TRANSPORT_LABELS[inc.transport]}</td>
                  <td className="tabular px-4 py-2">{new Date(inc.started_at).toLocaleString()}</td>
                  <td className="tabular px-4 py-2">
                    {inc.ended_at === null ? '—' : duration(inc.ended_at - inc.started_at)}
                  </td>
                  <td className="tabular px-4 py-2">{inc.fail_count}</td>
                </tr>
              ))}
              {!loading && incidents.length === 0 && (
                <tr>
                  <td
                    className="px-4 py-6 text-center"
                    colSpan={6}
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    No incidents recorded. 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
