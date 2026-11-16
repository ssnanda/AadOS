import { updateState } from '$lib/server/aados-store';
import { finishOAuth } from '$lib/server/zoho';
import { oauthLanding } from '$lib/server/oauth-landing';

export const GET = async ({ url }) => {
  const code = url.searchParams.get('code') || '';
  const returnedState = url.searchParams.get('state') || '';
  const error = url.searchParams.get('error') || '';
  if (error || !code || !returnedState) return oauthLanding(`/settings/emails?error=${encodeURIComponent(error || 'Zoho did not return an authorization code')}`);
  try {
    await updateState((state) => finishOAuth(state, code, returnedState, `${url.origin}/oauth/zoho/callback`));
  } catch (cause) {
    return oauthLanding(`/settings/emails?error=${encodeURIComponent(cause instanceof Error ? cause.message : 'Zoho connection failed')}`);
  }
  return oauthLanding('/settings/emails?zoho-connected=1');
};
