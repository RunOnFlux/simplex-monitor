import { NextResponse, type NextRequest } from 'next/server';

export function ok<T>(data: T): NextResponse {
  return NextResponse.json({ status: 'success', data });
}

export function err(code: number, name: string, message: string): NextResponse {
  return NextResponse.json({ status: 'error', data: { code, name, message } }, { status: code });
}

export function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? 'unknown';
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/** Set by middleware after verifying the session cookie. */
export function userEmail(request: NextRequest): string {
  return request.headers.get('x-user-email') ?? 'unknown';
}
