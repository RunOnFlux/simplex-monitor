import { err, ok } from '@/lib/api';
import { getServer } from '@/lib/config';
import { runSsh } from '@/lib/ssh';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = getServer(id);
  if (!server) return err(404, 'NotFound', `Unknown server ${id}`);
  const result = await runSsh(server, 'status');
  return ok({ unitState: result.stdout || (result.ok ? 'unknown' : 'unreachable') });
}
