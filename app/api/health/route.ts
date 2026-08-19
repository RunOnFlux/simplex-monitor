import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Unauthenticated liveness endpoint for checking the monitor itself
 * (e.g. from an external watchdog). Reports whether the prober has written
 * a probe recently; exposes no server details.
 */
export async function GET() {
  try {
    const row = getDb().prepare('SELECT MAX(ts) AS last FROM probes').get() as {
      last: number | null;
    };
    const lastProbeAgeSec = row.last === null ? null : Math.round((Date.now() - row.last) / 1000);
    return NextResponse.json({
      status: 'success',
      data: { web: 'ok', lastProbeAgeSec },
    });
  } catch (e) {
    return NextResponse.json(
      {
        status: 'error',
        data: { code: 500, name: 'InternalError', message: (e as Error).message },
      },
      { status: 500 },
    );
  }
}
