import type { LayoutServerLoad } from './$types';
import { readState } from '$lib/server/aados-store';

// Connected mailboxes for the settings sub-menu (no tokens).
export const load: LayoutServerLoad = async () => ({
  mailAccounts: (await readState()).accounts.map((account) => ({ id: account.id, provider: account.provider, email: account.email || account.id }))
});
