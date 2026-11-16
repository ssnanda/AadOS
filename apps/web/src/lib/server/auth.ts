import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

export const SESSION_COOKIE = 'aados_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;

function signingKey(): Buffer {
  const secret = env.AADOS_SESSION_SECRET || '';
  const passwordHash = env.AADOS_PASSWORD_HASH || '';
  if (secret.length < 64 || !passwordHash) throw new Error('AadOS authentication is not configured');
  return createHmac('sha256', secret).update(passwordHash).digest();
}

function signature(value: string): Buffer {
  return createHmac('sha256', signingKey()).update(value).digest();
}

export function createSession(): string {
  const payload = Buffer.from(JSON.stringify({ expires: Date.now() + SESSION_SECONDS * 1000 })).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}

export function validSession(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, encodedSignature, extra] = token.split('.');
  if (!payload || !encodedSignature || extra) return false;
  try {
    const supplied = Buffer.from(encodedSignature, 'base64url');
    const expected = signature(payload);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isSafeInteger(parsed.expires) && parsed.expires > Date.now();
  } catch {
    return false;
  }
}

export function sameUsername(value: string): boolean {
  const digest = (input: string) => createHash('sha256').update(input).digest();
  return timingSafeEqual(digest(value), digest(env.AADOS_USER || ''));
}

export const sessionCookieOptions = (secure: boolean) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'strict' as const,
  secure,
  maxAge: SESSION_SECONDS
});
