// Edge-safe session helpers: imported by middleware, must not pull in Node-only
// modules (better-sqlite3, fs). Reads the secret straight from the environment.
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'sm_session';

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('Missing required environment variable SESSION_SECRET');
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(email: string, days: number): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.email !== 'string') return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}
