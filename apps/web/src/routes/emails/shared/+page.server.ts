import type { PageServerLoad } from './$types';
import { readState } from '$lib/server/aados-store';
import { can } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals, url }) => {
  const state = await readState();
  return { aiAvailable: state.ai.enabled, asana: can(locals.user, 'asana') && Boolean(state.integrations.asana?.token), box: url.searchParams.get('box') || '', account: url.searchParams.get('account') || '' };
};
