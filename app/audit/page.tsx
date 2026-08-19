'use client';

import { Nav } from '@/components/Nav';
import { useApi } from '@/components/useApi';

interface AuditRow {
  id: number;
  email: string;
  server_id: string | null;
  action: string;
  ts: number;
  result: string;
}

export default function AuditPage() {
  const { data, error, loading } = useApi<{ audit: AuditRow[] }>('/api/audit', 60000);
  const rows = data?.audit ?? [];

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="mb-4 text-xl font-semibold">Audit log</h1>
        {error && (
          <div className="card mb-4 p-4 text-sm" style={{ color: 'var(--status-critical)' }}>
            {error}
          </div>
        )}
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: 'var(--ink-muted)' }}>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Server</th>
                <th className="px-4 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="tabular px-4 py-2">{new Date(row.ts).toLocaleString()}</td>
                  <td className="px-4 py-2">{row.email}</td>
                  <td className="px-4 py-2 font-medium">{row.action}</td>
                  <td className="px-4 py-2">{row.server_id ?? '—'}</td>
                  <td
                    className="px-4 py-2"
                    style={{
                      color:
                        row.result === 'success' ? 'var(--status-good)' : 'var(--status-critical)',
                    }}
                  >
                    {row.result}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    className="px-4 py-6 text-center"
                    colSpan={5}
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    No audited actions yet.
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
