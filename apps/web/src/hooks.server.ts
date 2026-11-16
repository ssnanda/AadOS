import { redirect, type Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, validSession } from '$lib/server/auth';

const PUBLIC_PATHS = new Set(['/health', '/login']);

export const handle: Handle = async ({ event, resolve }) => {
  const authenticated = validSession(event.cookies.get(SESSION_COOKIE));
  event.locals.authenticated = authenticated;
  const publicPath = PUBLIC_PATHS.has(event.url.pathname) || event.url.pathname.startsWith('/_app/');

  if (!authenticated && !publicPath) {
    throw redirect(303, '/login');
  }
  if (authenticated && event.url.pathname === '/login') {
    throw redirect(303, '/');
  }

  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
};
