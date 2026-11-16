import { timingSafeEqual } from 'node:crypto';

/** Constant-time OAuth `state` check; false when no flow is pending or it expired. */
export function validOAuthState(expected: string, expiresAt: number, returned: string): boolean {
  if (!expected || expiresAt < Date.now()) return false;
  const a = Buffer.from(expected), b = Buffer.from(returned);
  return a.length === b.length && timingSafeEqual(a, b);
}
