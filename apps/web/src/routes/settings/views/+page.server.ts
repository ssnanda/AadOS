import type { PageServerLoad } from './$types';
import { publicState, readState } from '$lib/server/aados-store';
import { actions as emailActions } from '../emails/+page.server';

// Email views (own Settings tab). Same create / pause actions as before, now on this page.
export const load: PageServerLoad = async () => publicState(await readState());
export const actions = { create: emailActions.create, toggle: emailActions.toggle };
