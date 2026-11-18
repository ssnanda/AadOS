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
export const resetContactCache = () => { globalThis.__aadosGContacts = undefined; globalThis.__aadosContactList = undefined; };

export type Person = { name: string; phones: string[]; emails: string[]; sources: string[] };
declare global { var __aadosContactList: { at: number; key: string; people: Person[] } | undefined; }

/** Full contact list from Google Contacts (Gmail accounts with Contacts ticked), merged across accounts by name + shared
 *  number/email. Read live, cached an hour; nothing is stored. */
export async function contactList(): Promise<Person[]> {
  const state = await readState();
  const accounts = state.accounts.filter((a) => a.provider === 'gmail' && a.contacts && !a.contactsOff);
  const key = accounts.map((a) => a.id).join(',');
  const cached = globalThis.__aadosContactList;
  if (cached && cached.key === key && Date.now() - cached.at < 3_600_000) return cached.people;
  const all: Person[] = [];
  if (accounts.length) await updateStateDetached(async (s) => {
    for (const a of s.accounts.filter((x) => accounts.some((y) => y.id === x.id))) {
      try { for (const c of await googleContacts(s, a)) all.push({ ...c, sources: [`Google · ${a.email}`] }); } catch { /* shown via account error */ }
    }
  }).catch(() => undefined);
  // Merge: same name and at least one shared phone/email (or same name with no contact details) is one person.
  const people: Person[] = [];
  const index = new Map<string, Person>();
  for (const c of all) {
    const keys = [...c.phones, ...c.emails].map(addressKey).filter(Boolean);
    const hit = keys.map((k) => index.get(`${c.name.toLowerCase()}|${k}`)).find(Boolean) || (!keys.length ? people.find((p) => p.name.toLowerCase() === c.name.toLowerCase()) : undefined);
    const target = hit || { name: c.name, phones: [], emails: [], sources: [] };
    if (!hit) people.push(target);
    for (const ph of c.phones) if (!target.phones.some((x) => addressKey(x) === addressKey(ph))) target.phones.push(ph);
    for (const em of c.emails) if (!target.emails.some((x) => x.toLowerCase() === em.toLowerCase())) target.emails.push(em);
    for (const s of c.sources) if (!target.sources.includes(s)) target.sources.push(s);
    for (const k of keys) index.set(`${c.name.toLowerCase()}|${k}`, target);
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  globalThis.__aadosContactList = { at: Date.now(), key, people };
  return people;
}
