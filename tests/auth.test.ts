import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-auth-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.SESSION_SECRET = 'test-secret-for-auth-tests';
process.env.ALLOWED_EMAILS = 'admin@example.com, second@example.com';

// Import after env is set so the lazily-read config picks it up.
const authPromise = import('../lib/auth');

describe('email OTP auth', () => {
  let auth: Awaited<typeof authPromise>;

  beforeAll(async () => {
    auth = await authPromise;
  });

  it('only allowlisted emails are recognized (case-insensitive)', () => {
    expect(auth.isAllowedEmail('admin@example.com')).toBe(true);
    expect(auth.isAllowedEmail('Admin@Example.COM')).toBe(true);
    expect(auth.isAllowedEmail('second@example.com')).toBe(true);
    expect(auth.isAllowedEmail('stranger@example.com')).toBe(false);
  });

  it('ignores unknown emails without revealing it', () => {
    const { result, code } = auth.prepareOtp('stranger@example.com', '10.0.0.1');
    expect(result).toBe('ignored');
    expect(code).toBeUndefined();
  });

  it('issues a code that verifies exactly once', () => {
    const { result, code } = auth.prepareOtp('admin@example.com', '10.0.0.2');
    expect(result).toBe('sent');
    expect(code).toMatch(/^\d{6}$/);
    expect(auth.verifyOtp('admin@example.com', code as string)).toBe(true);
    // Single use: the same code must not verify twice.
    expect(auth.verifyOtp('admin@example.com', code as string)).toBe(false);
  });

  it('rejects wrong codes and limits attempts', () => {
    const { code } = auth.prepareOtp('second@example.com', '10.0.0.3');
    for (let i = 0; i < 5; i++) {
      expect(auth.verifyOtp('second@example.com', '000000')).toBe(false);
    }
    // Attempt limit reached: even the right code no longer verifies.
    expect(auth.verifyOtp('second@example.com', code as string)).toBe(false);
  });

  it('rate limits repeated code requests per email', () => {
    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(auth.prepareOtp('admin@example.com', `10.0.1.${i}`).result);
    }
    expect(results).toContain('rate_limited');
  });
});
