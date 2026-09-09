import type { NextRequest } from 'next/server';
import { err, ok, userEmail } from '@/lib/api';
import { getServer } from '@/lib/config';
import { recordAudit } from '@/lib/db';
import { LOG_DEFAULT_LINES, LOG_MAX_LINES, normaliseTimestamp, runSsh } from '@/lib/ssh';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = getServer(id);
  if (!server) return err(404, 'NotFound', `Unknown server ${id}`);

  const params = request.nextUrl.searchParams;
  const rawSince = params.get('since');
  const rawUntil = params.get('until');
  const since = rawSince ? normaliseTimestamp(rawSince) : undefined;
  const until = rawUntil ? normaliseTimestamp(rawUntil) : undefined;
  if (rawSince && !since) return err(400, 'BadRequest', `Invalid 'since' timestamp: ${rawSince}`);
  if (rawUntil && !until) return err(400, 'BadRequest', `Invalid 'until' timestamp: ${rawUntil}`);

  const rawLines = params.get('lines');
  let lines = LOG_DEFAULT_LINES;
  if (rawLines !== null) {
    const parsed = Number(rawLines);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > LOG_MAX_LINES) {
      return err(400, 'BadRequest', `'lines' must be an integer between 1 and ${LOG_MAX_LINES}`);
    }
    lines = parsed;
  }

  const asFile = params.get('format') === 'text';

  try {
    const result = await runSsh(server, 'logs', {
      since: since ?? undefined,
      until: until ?? undefined,
      lines,
    });
    const window = [since ? `since=${since}` : null, until ? `until=${until}` : null, `n=${lines}`]
      .filter(Boolean)
      .join(' ');
    recordAudit(
      userEmail(request),
      server.id,
      `logs${asFile ? ' (download)' : ''} ${window}`,
      result.ok ? 'success' : 'failed',
    );
    if (!result.ok) {
      return err(500, 'SshError', result.stderr || 'SSH command failed');
    }
    if (asFile) {
      const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
      return new Response(result.stdout + '\n', {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${server.id}-journal-${stamp}.log"`,
        },
      });
    }
    return ok({ logs: result.stdout, since: since ?? null, until: until ?? null, lines });
  } catch (e) {
    return err(500, 'InternalError', (e as Error).message);
  }
}
