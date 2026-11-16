import { updateState } from '$lib/server/aados-store';
import { finishGmailOAuth } from '$lib/server/gmail';
import { oauthLanding } from '$lib/server/oauth-landing';

export const GET = async ({ url }) => {
  const code = url.searchParams.get('code') || '';
  const returnedState = url.searchParams.get('state') || '';
  const error = url.searchParams.get('error') || '';
  if (error || !code || !returnedState) return oauthLanding(`/settings/emails?error=${encodeURIComponent(error || 'Gmail did not return an authorization code')}`);
  try { await updateState((state) => finishGmailOAuth(state, code, returnedState, `${url.origin}/oauth/gmail/callback`)); }
  catch (cause) { return oauthLanding(`/settings/emails?error=${encodeURIComponent(cause instanceof Error ? cause.message : 'Gmail connection failed')}`); }
  return oauthLanding('/settings/emails?gmail-connected=1');
};
