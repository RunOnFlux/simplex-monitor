import { describe, expect, it } from 'vitest';
import type { ProbeRow } from '../lib/types';
import { certDaysLeft, dailyBuckets, uptimePercent } from '../lib/uptime';

const DAY = 24 * 60 * 60 * 1000;

function probe(ts: number, ok: boolean): ProbeRow {
  return { server_id: 's', transport: 'ipv4', ts, ok: ok ? 1 : 0, latency_ms: 100, error: null };
}

describe('uptimePercent', () => {
  it('returns null with no data', () => {
    expect(uptimePercent({ total: 0, up: 0 })).toBeNull();
  });
  it('computes percentage', () => {
    expect(uptimePercent({ total: 200, up: 199 })).toBeCloseTo(99.5);
    expect(uptimePercent({ total: 10, up: 10 })).toBe(100);
    expect(uptimePercent({ total: 10, up: 0 })).toBe(0);
  });
});

describe('dailyBuckets', () => {
  const now = Date.UTC(2026, 7, 15, 12, 0, 0);

  it('produces one bucket per day, oldest first', () => {
    const buckets = dailyBuckets([], 90, now);
    expect(buckets).toHaveLength(90);
    expect(buckets.every((b) => b.status === 'nodata')).toBe(true);
    const first = buckets[0];
    const last = buckets[89];
    expect(first && last && last.dayStartTs - first.dayStartTs).toBe(89 * DAY);
  });

  it('classifies up, degraded, down days', () => {
    const todayStart = Math.floor(now / DAY) * DAY;
    const probes = [
      probe(todayStart + 1000, true),
      probe(todayStart + 2000, true),
      probe(todayStart - DAY + 1000, true),
      probe(todayStart - DAY + 2000, false),
      probe(todayStart - 2 * DAY + 1000, false),
    ];
    const buckets = dailyBuckets(probes, 3, now);
    expect(buckets[0]?.status).toBe('down');
    expect(buckets[1]?.status).toBe('degraded');
    expect(buckets[2]?.status).toBe('up');
  });

  it('ignores probes older than the window', () => {
    const buckets = dailyBuckets([probe(now - 100 * DAY, true)], 90, now);
    expect(buckets.every((b) => b.total === 0)).toBe(true);
  });
});

describe('certDaysLeft', () => {
  it('handles null and computes days', () => {
    expect(certDaysLeft(null, 0)).toBeNull();
    expect(certDaysLeft(30 * DAY, 0)).toBe(30);
    expect(certDaysLeft(0, 5 * DAY)).toBe(-5);
  });
});
