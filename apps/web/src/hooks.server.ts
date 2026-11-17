import { error, redirect, type Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, allowedPath, sessionUser } from '$lib/server/auth';
import { startPipelineScheduler } from '$lib/server/pipeline-scheduler';
import { initStorage } from '$lib/server/aados-store';
import { startReminderScheduler } from '$lib/server/reminder-scheduler';
import { startTriageWorker } from '$lib/server/ai/email-service';
import { startExtractionWorker } from '$lib/server/documents/service';

const PUBLIC_PATHS = new Set(['/health', '/login', '/oauth/zoho/callback', '/oauth/gmail/callback']);
initStorage();
startPipelineScheduler();
startReminderScheduler();
startTriageWorker(); // does nothing unless AI + background triage are enabled in Settings → AI
startExtractionWorker();

export const handle: Handle = async ({ event, resolve }) => {
  const user = sessionUser(event.cookies.get(SESSION_COOKIE));
  const authenticated = Boolean(user);
  event.locals.authenticated = authenticated;
  event.locals.user = user;
  const publicPath = PUBLIC_PATHS.has(event.url.pathname) || event.url.pathname.startsWith('/_app/');

  if (!authenticated && !publicPath) {
    throw redirect(303, '/login');
  }
  if (authenticated && event.url.pathname === '/login') {
    throw redirect(303, '/');
  }
  // Family members only reach the sections the owner allowed (pages and their APIs alike).
  if (user && !allowedPath(user, event.url.pathname)) {
    if (event.request.method === 'GET' && event.request.headers.get('accept')?.includes('text/html')) throw redirect(303, '/?denied=1');
    throw error(403, 'You do not have access to this section.');
  }
  if (authenticated && event.url.pathname === '/settings/zoho') {
    throw redirect(303, '/settings/emails');
  }

  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
};
