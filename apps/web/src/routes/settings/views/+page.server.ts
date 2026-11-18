import type { PageServerLoad } from './$types';
import { publicState, readState } from '$lib/server/aados-store';
import { actions as emailActions } from '../emails/+page.server';

// Email views (own Settings tab): create, pause, remove; weekly review focus.
export const load: PageServerLoad = async () => publicState(await readState());
export const actions = { create: emailActions.create, toggle: emailActions.toggle, remove: emailActions.remove, focus: emailActions.focus };
