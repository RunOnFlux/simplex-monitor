export type Status = 'up' | 'down' | 'degraded' | 'nodata';

const COLORS: Record<Status, string> = {
  up: 'var(--status-good)',
  degraded: 'var(--status-warning)',
  down: 'var(--status-critical)',
  nodata: 'var(--status-nodata)',
};

const LABELS: Record<Status, string> = {
  up: 'Up',
  degraded: 'Degraded',
  down: 'Down',
  nodata: 'No data',
};

/** Status is never conveyed by color alone: dot + text label. */
export function StatusDot({ status, label }: { status: Status; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: COLORS[status] }}
      />
      <span className="text-sm" style={{ color: 'var(--ink-2)' }}>
        {label ?? LABELS[status]}
      </span>
    </span>
  );
}
