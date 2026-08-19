import type { ProbeRow } from './types';

/** Uptime percentage from up/total probe counts. Returns null when there is no data. */
export function uptimePercent(counts: { total: number; up: number }): number | null {
  if (counts.total === 0) return null;
  return (counts.up / counts.total) * 100;
}

export interface DayBucket {
  dayStartTs: number;
  total: number;
  up: number;
  /** 'up' (100%), 'degraded' (partial), 'down' (0%), 'nodata' */
  status: 'up' | 'degraded' | 'down' | 'nodata';
}

/**
 * Aggregate probe rows into per-UTC-day buckets covering the last `days` days
 * (oldest first). Days without probes are 'nodata'.
 */
export function dailyBuckets(probes: ProbeRow[], days: number, nowTs: number): DayBucket[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = Math.floor(nowTs / dayMs) * dayMs;
  const buckets: DayBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    buckets.push({ dayStartTs: todayStart - i * dayMs, total: 0, up: 0, status: 'nodata' });
  }
  const firstDay = buckets[0]?.dayStartTs ?? todayStart;
  for (const p of probes) {
    if (p.ts < firstDay) continue;
    const idx = Math.floor((p.ts - firstDay) / dayMs);
    const b = buckets[idx];
    if (!b) continue;
    b.total += 1;
    b.up += p.ok;
  }
  for (const b of buckets) {
    if (b.total === 0) b.status = 'nodata';
    else if (b.up === b.total) b.status = 'up';
    else if (b.up === 0) b.status = 'down';
    else b.status = 'degraded';
  }
  return buckets;
}

/** Days until a certificate expires; negative if already expired. */
export function certDaysLeft(notAfterTs: number | null, nowTs: number): number | null {
  if (notAfterTs === null) return null;
  return Math.floor((notAfterTs - nowTs) / (24 * 60 * 60 * 1000));
}
