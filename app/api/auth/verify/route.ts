import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { clientIp, err } from '@/lib/api';
import { verifyOtp } from '@/lib/auth';
import { appConfig } from '@/lib/config';
import { recordLoginEvent } from '@/lib/db';
import { SESSION_COOKIE, createSessionToken } from '@/lib/session';

export async function POST(request: NextRequest) {
  let body: { email?: unknown; code?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; code?: unknown };
  } catch {
    return err(400, 'BadRequest', 'Invalid JSON body');
  }
  const { email, code } = body;
  if (typeof email !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    return err(400, 'BadRequest', 'Email and 6-digit code are required');
  }
  const normalized = email.trim().toLowerCase();
  if (!verifyOtp(normalized, code)) {
    recordLoginEvent(normalized, clientIp(request), 'verify_fail');
    return err(401, 'Unauthorized', 'Invalid or expired code');
  }
  recordLoginEvent(normalized, clientIp(request), 'login');
  const token = await createSessionToken(normalized, appConfig.sessionDays);
  const response = NextResponse.json({ status: 'success', data: { email: normalized } });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: appConfig.sessionDays * 24 * 60 * 60,
  });
  return response;
}
