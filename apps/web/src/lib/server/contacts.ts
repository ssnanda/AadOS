// Contact names for phone numbers and email addresses, from Google Contacts on Gmail accounts where the owner ticked
// Contacts. Read live and cached in memory for an hour; nothing is stored. Used by Messages (and anywhere a name helps).
import { readState, updateStateDetached } from './aados-store';
import { googleContacts } from './gmail';
import { addressKey } from '$lib/messages-model';

declare global { var __aadosGContacts: { at: number; key: string; names: Map<string, string> } | undefined; }

export async function googleContactNames(): Promise<Map<string, string>> {
  const state = await readState();
  const accounts = state.accounts.filter((a) => a.provider === 'gmail' && a.contacts && !a.contactsOff);
  const key = accounts.map((a) => a.id).join(',');
  const cached = globalThis.__aadosGContacts;
  if (cached && cached.key === key && Date.now() - cached.at < 3_600_000) return cached.names;
  const names = new Map<string, string>();
  if (accounts.length) {
    await updateStateDetached(async (s) => {
      for (const a of s.accounts.filter((x) => accounts.some((y) => y.id === x.id))) {
        try { for (const c of await googleContacts(s, a)) for (const addr of [...c.phones, ...c.emails]) { const k = addressKey(addr); if (k && !names.has(k)) names.set(k, c.name); } }
        catch (e) { a.lastError = `Contacts: ${e instanceof Error ? e.message : 'failed'}`; }
      }
    }).catch(() => undefined);
  }
  globalThis.__aadosGContacts = { at: Date.now(), key, names };
  return names;
}
/** Forget cached names (after Contacts is turned on/off). */
export const resetContactCache = () => { globalThis.__aadosGContacts = undefined; };
