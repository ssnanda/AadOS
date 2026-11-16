import { env } from '$env/dynamic/private';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { createSession, sameUsername, SESSION_COOKIE, sessionCookieOptions } from '$lib/server/auth';
import { verifyPassword } from '$lib/server/password.js';

const failures = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 8;

export const actions: Actions = {
  default: async ({ cookies, getClientAddress, request, url }) => {
    const address = getClientAddress();
    const now = Date.now();
    const recent = (failures.get(address) || []).filter((time) => now - time < WINDOW_MS);
    if (recent.length >= MAX_FAILURES) return fail(429, { error: 'Too many attempts. Try again later.' });

    const data = await request.formData();
    const username = String(data.get('username') || '');
    const password = String(data.get('password') || '');
    const valid = sameUsername(username) && await verifyPassword(password, env.AADOS_PASSWORD_HASH || '');
    if (!valid) {
      recent.push(now);
      failures.set(address, recent);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return fail(400, { error: 'Invalid username or password.', username });
    }

    failures.delete(address);
    const secure = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
    cookies.set(SESSION_COOKIE, createSession(), sessionCookieOptions(secure));
    throw redirect(303, '/');
  }
};
