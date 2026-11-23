// Username/password check shared by the web login form and the mobile app's token login.
// Failed attempts are counted per client address in security.json, so a restart does not reset the lockout.
import { env } from '$env/dynamic/private';
import { ownerPasswordHash, sameUsername, security } from './auth';
import { verifyPassword } from './password.js';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 8;

export type LoginResult =
  | { ok: true; member?: { id: string; ver: number } }
  | { ok: false; status: 400 | 429; error: string };

/** The owner (deployment login), else an enabled family member created in Settings → Family. */
export async function checkLogin(username: string, password: string, address: string): Promise<LoginResult> {
  if (security().recentFailures(address, WINDOW_MS) >= MAX_FAILURES) return { ok: false, status: 429, error: 'Too many attempts. Try again later.' };
  let member: { id: string; ver: number } | undefined;
  let valid = sameUsername(username) && await verifyPassword(password, env.AADOS_PASSWORD_HASH ? ownerPasswordHash() : '');
  if (!valid) {
    const m = security().memberByUsername(username);
    if (m && !m.disabled && await verifyPassword(password, m.passwordHash)) { valid = true; member = { id: m.id, ver: m.ver }; }
  }
  if (!valid) {
    security().addFailure(address, WINDOW_MS);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { ok: false, status: 400, error: 'Invalid username or password.' };
  }
  security().clearFailures(address);
  return { ok: true, member };
}
