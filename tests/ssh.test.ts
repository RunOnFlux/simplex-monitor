import { describe, expect, it } from 'vitest';
import { normaliseTimestamp } from '../lib/ssh';

describe('normaliseTimestamp', () => {
  it('formats an ISO instant as a journalctl UTC timestamp', () => {
    expect(normaliseTimestamp('2026-09-08T14:05:09.123Z')).toBe('2026-09-08 14:05:09 UTC');
  });

  it('converts an offset timestamp to UTC', () => {
    expect(normaliseTimestamp('2026-09-08T16:00:00+02:00')).toBe('2026-09-08 14:00:00 UTC');
  });

  it('rejects anything that is not a timestamp', () => {
    expect(normaliseTimestamp("' ; rm -rf / ; '")).toBeNull();
    expect(normaliseTimestamp('')).toBeNull();
  });
});
