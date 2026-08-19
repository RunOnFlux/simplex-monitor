import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { appConfig } from './config';
import {
  bumpOtpAttempts,
  countLoginEvents,
  deleteOtp,
  getOtp,
  recordLoginEvent,
  saveOtp,
} from './db';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_CODES_PER_EMAIL_15MIN = 3;
const MAX_CODES_PER_IP_HOUR = 12;

function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`${email}:${code}:${appConfig.sessionSecret}`).digest('hex');
}

export function isAllowedEmail(email: string): boolean {
  return appConfig.allowedEmails.includes(email.trim().toLowerCase());
}

export type RequestCodeResult = 'sent' | 'ignored' | 'rate_limited';

/**
 * Generates + stores an OTP for an allowlisted email. Returns 'ignored' for
 * unknown emails (callers must respond identically to prevent allowlist
 * enumeration) and 'rate_limited' when limits are hit.
 */
export function prepareOtp(
  email: string,
  ip: string,
): { result: RequestCodeResult; code?: string } {
  const normalized = email.trim().toLowerCase();
  const now = Date.now();
  if (
    countLoginEvents({ ip, kind: 'request', sinceTs: now - 60 * 60 * 1000 }) >=
    MAX_CODES_PER_IP_HOUR
  ) {
    return { result: 'rate_limited' };
  }
  recordLoginEvent(normalized, ip, 'request');
  if (!isAllowedEmail(normalized)) return { result: 'ignored' };
  if (
    countLoginEvents({ email: normalized, kind: 'sent', sinceTs: now - 15 * 60 * 1000 }) >=
    MAX_CODES_PER_EMAIL_15MIN
  ) {
    return { result: 'rate_limited' };
  }
  const code = randomInt(0, 1000000).toString().padStart(6, '0');
  saveOtp(normalized, hashCode(normalized, code), now + OTP_TTL_MS);
  recordLoginEvent(normalized, ip, 'sent');
  return { result: 'sent', code };
}

export function verifyOtp(email: string, code: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!isAllowedEmail(normalized)) return false;
  const stored = getOtp(normalized);
  if (!stored) return false;
  if (stored.expires_at < Date.now() || stored.attempts >= MAX_VERIFY_ATTEMPTS) {
    deleteOtp(normalized);
    return false;
  }
  bumpOtpAttempts(normalized);
  const expected = Buffer.from(stored.code_hash, 'hex');
  const actual = Buffer.from(hashCode(normalized, code.trim()), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  deleteOtp(normalized);
  return true;
}
