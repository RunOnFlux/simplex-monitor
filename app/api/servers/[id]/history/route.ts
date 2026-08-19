import type { NextRequest } from 'next/server';
import { err, ok } from '@/lib/api';
import { getServer } from '@/lib/config';
import { listIncidents } from '@/lib/db';
import { buildHistory } from '@/lib/fleet';

export const dynamic = 'force-dynamic';

const RANGES: Record<string, number> = {
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = getServer(id);
  if (!server) return err(404, 'NotFound', `Unknown server ${id}`);
  const range = request.nextUrl.searchParams.get('range') ?? '24h';
  const rangeMs = RANGES[range];
  if (!rangeMs) return err(400, 'BadRequest', 'range must be one of 6h, 24h, 7d, 30d');
  try {
    return ok({ history: buildHistory(id, rangeMs), incidents: listIncidents(50, id) });
  } catch (e) {
    return err(500, 'InternalError', (e as Error).message);
  }
}
