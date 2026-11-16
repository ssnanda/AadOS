import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, sessionCookieOptions } from '$lib/server/auth';

export const POST = ({ cookies, request, url }) => {
  const secure = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  cookies.delete(SESSION_COOKIE, sessionCookieOptions(secure));
  throw redirect(303, '/login');
};
