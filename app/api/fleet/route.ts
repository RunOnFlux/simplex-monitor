import { err, ok } from '@/lib/api';
import { buildFleet } from '@/lib/fleet';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return ok({ servers: buildFleet() });
  } catch (e) {
    return err(500, 'InternalError', (e as Error).message);
  }
}
