import { updateState } from '$lib/server/aados-store';
import { finishGmailOAuth } from '$lib/server/gmail';
import { oauthLanding } from '$lib/server/oauth-landing';
import { security } from '$lib/server/auth';
import { mobileOutcome } from '$lib/server/oauth-mobile';

// The owner lands on Settings; a family member who linked their own account lands on My accounts.
export const GET = async ({ url, locals }) => {
  const back = locals.user && !locals.user.owner ? '/me/accounts' : '/settings/emails';
  const code = url.searchParams.get('code') || '';
  const returnedState = url.searchParams.get('state') || '';
  const error = url.searchParams.get('error') || '';
  if (error || !code || !returnedState) return mobileOutcome(returnedState, false, error || 'Gmail did not return an authorization code') || oauthLanding(`${back}?error=${encodeURIComponent(error || 'Gmail did not return an authorization code')}`);
  let result: { owner: string; accountId: string } | undefined;
  try { await updateState(async (state) => { result = await finishGmailOAuth(state, code, returnedState, `${url.origin}/oauth/gmail/callback`); }); }
  catch (cause) { const message = cause instanceof Error ? cause.message : 'Gmail connection failed'; return mobileOutcome(returnedState, false, message) || oauthLanding(`${back}?error=${encodeURIComponent(message)}`); }
  // A member's own account joins the mailboxes they can see.
  if (result?.owner) { const m = security().member(result.owner); if (m && m.mailboxes !== 'all' && !m.mailboxes.includes(result.accountId)) { m.mailboxes = [...m.mailboxes, result.accountId]; security().saveMember(m); } }
  // Started from the mobile app: a "return to the app" page (this browser has no AadOS session).
  const app = mobileOutcome(returnedState, true, 'Gmail account connected.');
  if (app) return app;
  return oauthLanding(result?.owner ? '/me/accounts?connected=1' : '/settings/emails?gmail-connected=1');
};
