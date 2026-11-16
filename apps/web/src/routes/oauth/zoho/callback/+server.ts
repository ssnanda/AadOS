import { redirect } from '@sveltejs/kit';
import { updateState } from '$lib/server/aados-store';
import { finishOAuth } from '$lib/server/zoho';

export const GET = async ({ url }) => {
  const code = url.searchParams.get('code') || '';
  const returnedState = url.searchParams.get('state') || '';
  const error = url.searchParams.get('error') || '';
  if (error || !code || !returnedState) throw redirect(303, `/settings/emails?error=${encodeURIComponent(error || 'Zoho did not return an authorization code')}`);
  try {
    await updateState((state) => finishOAuth(state, code, returnedState, `${url.origin}/oauth/zoho/callback`));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Zoho connection failed';
    throw redirect(303, `/settings/emails?error=${encodeURIComponent(message)}`);
  }
  throw redirect(303, '/settings/emails?zoho-connected=1');
};
