import type { NextRequest } from 'next/server';
import { err, ok, userEmail } from '@/lib/api';
import { getServer } from '@/lib/config';
import { recordAudit } from '@/lib/db';
import { runSsh } from '@/lib/ssh';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = getServer(id);
  if (!server) return err(404, 'NotFound', `Unknown server ${id}`);
  let service: unknown = 'simplex';
  try {
    const body = (await request.json()) as { service?: unknown };
    if (body.service !== undefined) service = body.service;
  } catch {
    // no body: default target
  }
  if (service !== 'simplex' && service !== 'tor') {
    return err(400, 'BadRequest', 'service must be "simplex" or "tor"');
  }
  const email = userEmail(request);
  const result = await runSsh(server, service === 'tor' ? 'restart-tor' : 'restart');
  recordAudit(
    email,
    server.id,
    service === 'tor' ? 'restart-tor' : 'restart',
    result.ok ? 'success' : `failed: ${result.stderr || result.stdout}`.slice(0, 500),
  );
  if (!result.ok) {
    return err(502, 'SshError', result.stderr || result.stdout || 'SSH command failed');
  }
  const status = await runSsh(server, service === 'tor' ? 'status-tor' : 'status');
  return ok({ restarted: true, unitState: status.stdout || 'unknown' });
}
