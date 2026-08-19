import { err, ok } from '@/lib/api';
import { listIncidents } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return ok({ incidents: listIncidents(200) });
  } catch (e) {
    return err(500, 'InternalError', (e as Error).message);
  }
}
