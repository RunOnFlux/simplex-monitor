import type { NextRequest } from 'next/server';
import { err, ok, userEmail } from '@/lib/api';
import { getServer } from '@/lib/config';
import { recordAudit } from '@/lib/db';
import { runSsh } from '@/lib/ssh';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = getServer(id);
  if (!server) return err(404, 'NotFound', `Unknown server ${id}`);
  try {
    const result = await runSsh(server, 'logs');
    recordAudit(userEmail(request), server.id, 'logs', result.ok ? 'success' : 'failed');
    if (!result.ok) {
      return err(502, 'SshError', result.stderr || 'SSH command failed');
    }
    return ok({ logs: result.stdout });
  } catch (e) {
    return err(500, 'InternalError', (e as Error).message);
  }
}
