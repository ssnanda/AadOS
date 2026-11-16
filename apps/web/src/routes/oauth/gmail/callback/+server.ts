import { redirect } from '@sveltejs/kit';
import { updateState } from '$lib/server/aados-store';
import { finishGmailOAuth } from '$lib/server/gmail';

export const GET = async ({ url }) => {
  const code = url.searchParams.get('code') || '';
  const returnedState = url.searchParams.get('state') || '';
  if (!code || !returnedState) throw redirect(303, '/settings/emails?error=Gmail%20did%20not%20return%20an%20authorization%20code');
  try { await updateState((state) => finishGmailOAuth(state, code, returnedState, `${url.origin}/oauth/gmail/callback`)); }
  catch (cause) { throw redirect(303, `/settings/emails?error=${encodeURIComponent(cause instanceof Error ? cause.message : 'Gmail connection failed')}`); }
  throw redirect(303, '/settings/emails?gmail-connected=1');
};
