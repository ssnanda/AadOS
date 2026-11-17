import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { env } from '$env/dynamic/private';
import { dataDir } from './data-dir';
import { SecurityStore, PERMISSIONS, type Permission } from './security-store';

export const SESSION_COOKIE = 'aados_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;

const fingerprint = (v: string) => createHash('sha256').update(`aados-password-base:${v}`).digest('hex');
/** Current owner password hash (Settings change, else the deployment's AADOS_PASSWORD_HASH). */
export const ownerPasswordHash = () => security().effectivePasswordHash(env.AADOS_PASSWORD_HASH || '', fingerprint);
/** Store a new owner password hash. Sessions are signed with the hash, so every other session ends. */
export const setOwnerPasswordHash = (hash: string) => security().setPasswordHash(hash, env.AADOS_PASSWORD_HASH || '', fingerprint);

function signingKey(): Buffer {
  const secret = env.AADOS_SESSION_SECRET || '';
  const passwordHash = env.AADOS_PASSWORD_HASH ? ownerPasswordHash() : '';
  if (secret.length < 64 || !passwordHash) throw new Error('AadOS authentication is not configured');
  return createHmac('sha256', secret).update(passwordHash).digest();
}

function signature(value: string): Buffer {
  return createHmac('sha256', signingKey()).update(value).digest();
}

export const security = () => new SecurityStore(dataDir());

/** `uid`: absent = the owner; else a family member id, with the member's `ver` (bumped on password change/disable). */
export function createSession(member?: { id: string; ver: number }): string {
  const payload = Buffer.from(JSON.stringify({ iat: Date.now(), expires: Date.now() + SESSION_SECONDS * 1000, ...(member ? { uid: member.id, ver: member.ver } : {}) })).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}

/** Who is signed in. The owner can do everything; a family member only what the owner allowed. */
export type SessionUser = { id: string; name: string; owner: boolean; permissions: Permission[]; mailboxes: string[] | 'all' };
const OWNER = (): SessionUser => ({ id: 'owner', name: env.AADOS_USER || 'Owner', owner: true, permissions: [...PERMISSIONS], mailboxes: 'all' });

export function sessionUser(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const [payload, encodedSignature, extra] = token.split('.');
  if (!payload || !encodedSignature || extra) return null;
  try {
    const supplied = Buffer.from(encodedSignature, 'base64url');
    const expected = signature(payload);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!(Number.isSafeInteger(parsed.expires) && parsed.expires > Date.now() && (Number(parsed.iat) || 0) >= security().validAfter())) return null;
    if (!parsed.uid) return OWNER();
    const m = security().member(String(parsed.uid));
    if (!m || m.disabled || m.ver !== parsed.ver) return null;
    return { id: m.id, name: m.name, owner: false, permissions: m.permissions, mailboxes: m.mailboxes };
  } catch { return null; }
}

export function validSession(token: string | undefined): boolean { return Boolean(sessionUser(token)); }


/** May this user read this mailbox (account id)? */
export const canSeeAccount = (user: SessionUser | null | undefined, accountId: string) => Boolean(user && (user.mailboxes === 'all' || user.mailboxes.includes(accountId)));
export const can = (user: SessionUser | null | undefined, p: Permission) => Boolean(user && (user.owner || user.permissions.includes(p)));

// Section of the app each path belongs to. Paths not listed are owner-only (Settings, OAuth, …).
const SECTIONS: [string, Permission][] = [['/emails', 'emails'], ['/search', 'emails'], ['/pipelines', 'emails'], ['/sync', 'emails'], ['/calendar', 'calendar'], ['/tasks', 'tasks'], ['/reminders', 'reminders'], ['/asana', 'asana'], ['/documents', 'documents'], ['/assistant', 'assistant'], ['/briefing', 'assistant']];
const OPEN = new Set(['/', '/logout', '/health', '/login', '/settings/timezone']);
export function allowedPath(user: SessionUser, pathname: string): boolean {
  if (user.owner || OPEN.has(pathname) || pathname.startsWith('/_app/')) return true;
  const hit = SECTIONS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`));
  return Boolean(hit && user.permissions.includes(hit[1]));
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
