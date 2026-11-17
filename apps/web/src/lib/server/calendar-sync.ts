// Read-only calendar sync for Google and Zoho accounts that granted calendar access. Never writes to a provider.
import type { AadOSState, MailAccount } from './aados-store';
import { fetchRetry } from './retry.ts';
import { listCalendars, syncCalendar } from '../calendar/google.ts';
import { fetchZohoEvents, listZohoCalendars } from '../calendar/zoho.ts';
import { mergeGoogle, pruneAccount, replaceCalendarEvents } from '../calendar/merge.ts';

type Http = (url: string, init?: RequestInit) => Promise<Response>;
type Tokens = { google: (s: AadOSState, a: MailAccount) => Promise<string>; zoho: (s: AadOSState, a: MailAccount) => Promise<string> };
// Token providers are loaded lazily so this module stays importable (and unit-testable) without the framework.
const realTokens = async (): Promise<Tokens> => ({ google: (await import('./gmail')).gmailAccessToken, zoho: (await import('./zoho')).zohoAccessToken });
const DAY = 86_400_000;

async function syncGoogle(http: Http, tokens: Tokens, state: AadOSState, account: MailAccount, now: number) {
  const token = await tokens.google(state, account);
  const calendars = await listCalendars(http, token, account.id);
  for (const calendar of calendars) {
    if (state.calendarDisabled.includes(calendar.id)) { dropCalendar(state, calendar.id); continue; }
    const result = await syncCalendar(http, token, calendar, state.calendarSync[calendar.id] || '', new Date(now - 30 * DAY).toISOString());
    state.events = mergeGoogle(state.events, calendar.id, result);
    if (result.nextSyncToken) state.calendarSync[calendar.id] = result.nextSyncToken;
  }
  return calendars;
}

async function syncZoho(http: Http, tokens: Tokens, state: AadOSState, account: MailAccount, now: number) {
  const token = await tokens.zoho(state, account);
  const calendars = await listZohoCalendars(http, state.zoho.dataCenter, token, account.id);
  // One calendar Zoho refuses (e.g. a holiday or shared calendar answering 404) must not fail the whole account.
  const failures: string[] = [];
  for (const calendar of calendars) {
    if (state.calendarDisabled.includes(calendar.id)) { dropCalendar(state, calendar.id); continue; }
    try { state.events = replaceCalendarEvents(state.events, calendar.id, await fetchZohoEvents(http, state.zoho.dataCenter, token, calendar, new Date(now - 7 * DAY), new Date(now + 90 * DAY))); }
    catch (cause) { failures.push(`${calendar.name}: ${cause instanceof Error ? cause.message : 'failed'}`); }
  }
  if (failures.length && failures.length === calendars.filter((c) => !state.calendarDisabled.includes(c.id)).length) throw new Error(failures.join(' · '));
  return calendars;
}

/** A disabled calendar keeps its listing (so it can be re-enabled) but no events or sync token. */
function dropCalendar(state: AadOSState, calendarId: string) {
  state.events = state.events.filter((e) => e.calendarId !== calendarId);
  delete state.calendarSync[calendarId];
}

const PERMISSION = /insufficient|forbidden|unauthori[sz]ed|invalid_grant|invalid[_ ]?(oauth)?token|permission|HTTP 40[13]|expired or was revoked/i;

/** Sync every calendar-enabled account (or one). Per-account errors are recorded, not thrown. */
export async function syncCalendars(state: AadOSState, only?: string, now = Date.now(), deps: { http?: Http; tokens?: Tokens } = {}): Promise<{ accounts: number; failed: number }> {
  const http = deps.http ?? ((url: string, init?: RequestInit) => fetchRetry(url, init));
  let tokens = deps.tokens;
  let accounts = 0, failed = 0;
  // Accounts whose Calendar checkbox is off are skipped (their mail setting does not matter).
  for (const account of state.accounts.filter((a) => a.calendar && !a.calendarOff && (only ? a.id === only : true))) {
    accounts++;
    try {
      tokens ??= await realTokens();
      const calendars = account.provider === 'gmail' ? await syncGoogle(http, tokens, state, account, now) : await syncZoho(http, tokens, state, account, now);
      const pruned = pruneAccount([...state.calendars.filter((c) => c.accountId !== account.id), ...calendars], state.events, state.calendarSync, account.id, new Set(calendars.map((c) => c.id)));
      state.calendars = pruned.calendars; state.events = pruned.events; state.calendarSync = pruned.tokens;
      account.calendarLastSync = new Date(now).toISOString(); account.calendarError = '';
    } catch (cause) {
      failed++;
      const message = cause instanceof Error ? cause.message : 'Calendar sync failed';
      // Existing events are kept; the owner re-grants access with "Enable calendar".
      account.calendarError = PERMISSION.test(message) ? `Calendar permission is missing or expired (${message}). Use “Enable calendar” to grant it again.` : message;
    }
  }
  return { accounts, failed };
}

/** Local privacy control: forget an account's calendar data (the provider grant itself is revoked in the provider's settings). */
export function clearCalendarData(state: AadOSState, accountId: string) {
  const ids = new Set(state.calendars.filter((c) => c.accountId === accountId).map((c) => c.id));
  state.calendars = state.calendars.filter((c) => c.accountId !== accountId);
  state.events = state.events.filter((e) => e.accountId !== accountId);
  state.calendarSync = Object.fromEntries(Object.entries(state.calendarSync).filter(([id]) => !ids.has(id)));
  const account = state.accounts.find((a) => a.id === accountId);
  if (account) { account.calendar = false; account.calendarError = ''; account.calendarLastSync = ''; }
}
