import type { PageServerLoad } from './$types';
import { readState } from '$lib/server/aados-store';
import { contactList } from '$lib/server/contacts';

// Contacts: Google Contacts (read-only, live, cached an hour) + Messages sender groups (e.g. "Atrium notifications").
export const load: PageServerLoad = async ({ locals }) => {
  const state = await readState();
  const google = state.accounts.filter((a) => a.provider === 'gmail' && a.contacts && !a.contactsOff);
  return {
    people: google.length ? await contactList().catch(() => []) : [],
    groups: state.messageGroups ?? [],
    contactsOn: google.length > 0, accounts: google.map((a) => a.email),
    errors: state.accounts.filter((a) => (a.lastError || '').startsWith('Contacts:')).map((a) => `${a.email}: ${a.lastError}`),
    owner: Boolean(locals.user?.owner)
  };
};
