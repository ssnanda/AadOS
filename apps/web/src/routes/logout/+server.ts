import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, security, sessionCookieOptions } from '$lib/server/auth';

// all=1: revoke every session (all devices) server-side, not just this cookie.
export const POST = async ({ cookies, request, url }) => {
  if ((await request.formData().catch(() => new FormData())).get('all') === '1') security().revokeAllSessions();
  const secure = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  cookies.delete(SESSION_COOKIE, sessionCookieOptions(secure));
  throw redirect(303, '/login');
};
