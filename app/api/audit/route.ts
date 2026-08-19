import { err, ok } from '@/lib/api';
import { listAudit } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return ok({ audit: listAudit(200) });
  } catch (e) {
    return err(500, 'InternalError', (e as Error).message);
  }
}
