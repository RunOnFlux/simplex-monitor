'use client';

export interface DayBucketView {
  dayStartTs: number;
  total: number;
  up: number;
  status: 'up' | 'degraded' | 'down' | 'nodata';
}

const COLORS: Record<DayBucketView['status'], string> = {
  up: 'var(--status-good)',
  degraded: 'var(--status-warning)',
  down: 'var(--status-critical)',
  nodata: 'var(--status-nodata)',
};

/** Uptime-Kuma-style 90-day strip: one slat per UTC day, tooltip with detail. */
export function UptimeBar({ buckets }: { buckets: DayBucketView[] }) {
  return (
    <div className="flex h-8 items-stretch gap-[2px]" role="img" aria-label="90 day uptime history">
      {buckets.map((b) => {
        const pct = b.total > 0 ? ((b.up / b.total) * 100).toFixed(1) : null;
        const day = new Date(b.dayStartTs).toISOString().slice(0, 10);
        return (
          <div
            key={b.dayStartTs}
            className="min-w-[3px] flex-1 rounded-[2px]"
            style={{ background: COLORS[b.status] }}
            title={pct === null ? `${day}: no data` : `${day}: ${pct}% (${b.up}/${b.total} checks)`}
          />
        );
      })}
    </div>
  );
}
