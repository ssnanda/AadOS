import { redirect, type Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, validSession } from '$lib/server/auth';
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
  const authenticated = validSession(event.cookies.get(SESSION_COOKIE));
  event.locals.authenticated = authenticated;
  const publicPath = PUBLIC_PATHS.has(event.url.pathname) || event.url.pathname.startsWith('/_app/');

  if (!authenticated && !publicPath) {
    throw redirect(303, '/login');
  }
  if (authenticated && event.url.pathname === '/login') {
    throw redirect(303, '/');
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
