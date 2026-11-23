import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createSession, SESSION_COOKIE, sessionCookieOptions } from '$lib/server/auth';
import { checkLogin } from '$lib/server/login';

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
    const data = await request.formData();
    const username = String(data.get('username') || '');
    const password = String(data.get('password') || '');
    const submittedToken = String(data.get('csrfToken') || '');
    const cookieToken = cookies.get(CSRF_COOKIE) || '';
    if (!submittedToken || !cookieToken || !sameToken(submittedToken, cookieToken)) return fail(403, { error: 'Login form expired. Reload and try again.', username });
    // Same check (and lockout) as the mobile app's token login.
    const result = await checkLogin(username, password, getClientAddress());
    if (!result.ok) return fail(result.status, { error: result.error, username: result.status === 429 ? '' : username });
    const member = result.member;
    const secure = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
    cookies.set(SESSION_COOKIE, createSession(member), sessionCookieOptions(secure));
    cookies.delete(CSRF_COOKIE, { path: '/login' });
    throw redirect(303, '/');
  }
};
