import { env } from '$env/dynamic/private';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createSession, ownerPasswordHash, security, sameUsername, SESSION_COOKIE, sessionCookieOptions } from '$lib/server/auth';
import { verifyPassword } from '$lib/server/password.js';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 8;
const CSRF_COOKIE = 'aados_login_csrf';

const sameToken = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const load: PageServerLoad = ({ cookies, request, url }) => {
  const token = randomBytes(24).toString('base64url');
  const secure = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  cookies.set(CSRF_COOKIE, token, { path: '/login', httpOnly: true, sameSite: 'strict', secure, maxAge: 10 * 60 });
  return { csrfToken: token };
};

export const actions: Actions = {
  default: async ({ cookies, getClientAddress, request, url }) => {
    const address = getClientAddress();
    // Counters live in security.json so a restart does not reset the lockout.
    if (security().recentFailures(address, WINDOW_MS) >= MAX_FAILURES) return fail(429, { error: 'Too many attempts. Try again later.', username: '' });

    const data = await request.formData();
    const username = String(data.get('username') || '');
    const password = String(data.get('password') || '');
    const submittedToken = String(data.get('csrfToken') || '');
    const cookieToken = cookies.get(CSRF_COOKIE) || '';
    if (!submittedToken || !cookieToken || !sameToken(submittedToken, cookieToken)) return fail(403, { error: 'Login form expired. Reload and try again.', username });
    const valid = sameUsername(username) && await verifyPassword(password, env.AADOS_PASSWORD_HASH ? ownerPasswordHash() : '');
    if (!valid) {
      security().addFailure(address, WINDOW_MS);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return fail(400, { error: 'Invalid username or password.', username });
    }

    security().clearFailures(address);
    const secure = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
    cookies.set(SESSION_COOKIE, createSession(), sessionCookieOptions(secure));
    cookies.delete(CSRF_COOKIE, { path: '/login' });
    throw redirect(303, '/');
  }
};
