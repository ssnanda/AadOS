import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncCalendars, clearCalendarData } from '../src/lib/server/calendar-sync.ts';
import { mergeGoogle, pruneAccount } from '../src/lib/calendar/merge.ts';
import { fetchZohoEvents } from '../src/lib/calendar/zoho.ts';
import { mergeSync } from '../src/lib/server/sync-merge.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const tokens = { google: async () => 'GTOKEN', zoho: async () => 'ZTOKEN' };
const mk = () => ({ calendars: [], events: [], calendarSync: {}, calendarDisabled: [] as string[], zoho: { dataCenter: 'in' },
  accounts: [{ id: 'g1', provider: 'gmail', email: 'a@x.com', calendar: true }, { id: 'z1', provider: 'zoho', email: 'z@x.com', calendar: true }, { id: 'g2', provider: 'gmail', email: 'no@x.com' }] }) as any;
const NOW = Date.parse('2026-11-16T12:00:00Z');

function fakeProviders(opts: { expire410?: boolean } = {}) {
  const calls: { url: string; auth: string; method: string }[] = [];
  const http = async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: String((init?.headers as any)?.Authorization), method: init?.method || 'GET' });
    if (url.includes('/calendarList')) return json({ items: [{ id: 'primary', summary: 'Me', timeZone: 'America/New_York', primary: true }] });
    if (url.includes('googleapis.com/calendar/v3/calendars/')) {
      if (opts.expire410 && url.includes('syncToken=')) return json({ error: { message: 'Gone' } }, 410);
      return json({ items: [{ id: 'e1', summary: 'Lunch', start: { dateTime: '2026-11-17T12:00:00-05:00' }, end: { dateTime: '2026-11-17T13:00:00-05:00' } }, { id: 'old', status: 'cancelled' }], nextSyncToken: url.includes('syncToken=') ? 'S2' : 'S1' });
    }
    if (url.endsWith('/api/v1/calendars')) return json({ calendars: [{ uid: 'zc', name: 'Home', timezone: 'Asia/Kolkata' }] });
    if (url.includes('/events?range=')) return json({ events: [{ uid: 'ze', title: 'Gym', dateandtime: { start: '20261118T010000Z', end: '20261118T020000Z', timezone: 'Asia/Kolkata' } }] });
    return json({}, 404);
  };
  return { http, calls };
}

test('syncs only calendar-enabled accounts, read-only GETs, correct auth per provider, stores sync tokens', async () => {
  const s = mk(), { http, calls } = fakeProviders();
  const r = await syncCalendars(s, undefined, NOW, { http, tokens });
  assert.deepEqual(r, { accounts: 2, failed: 0 });
  assert.deepEqual(s.calendars.map((c: any) => c.id).sort(), ['g1:primary', 'z1:zc']);
  assert.deepEqual(s.events.map((e: any) => e.title).sort(), ['Gym', 'Lunch']);
  assert.equal(s.calendarSync['g1:primary'], 'S1');
  assert.ok(calls.every((c) => c.method === 'GET'));
  assert.ok(calls.filter((c) => c.url.includes('googleapis')).every((c) => c.auth === 'Bearer GTOKEN'));
  assert.ok(calls.filter((c) => c.url.includes('zoho')).every((c) => c.auth === 'Zoho-oauthtoken ZTOKEN'));
  assert.ok(calls.some((c) => c.url.startsWith('https://calendar.zoho.in/')));
  assert.equal(s.accounts[0].calendarError, ''); assert.ok(s.accounts[0].calendarLastSync);
  assert.equal(s.accounts[2].calendarLastSync, undefined); // not enabled
});

test('second run is incremental via syncToken; an expired token falls back to a full sync without losing events', async () => {
  const s = mk(); await syncCalendars(s, 'g1', NOW, { http: fakeProviders().http, tokens });
  const inc = fakeProviders(); await syncCalendars(s, 'g1', NOW, { http: inc.http, tokens });
  assert.ok(inc.calls.some((c) => c.url.includes('syncToken=S1'))); assert.equal(s.calendarSync['g1:primary'], 'S2'); assert.equal(s.events.length, 1);
  const gone = fakeProviders({ expire410: true }); await syncCalendars(s, 'g1', NOW, { http: gone.http, tokens });
  assert.equal(s.events.length, 1); assert.equal(s.calendarSync['g1:primary'], 'S1');
});

test('provider failure is recorded per account and does not stop the others or lose data', async () => {
  const s = mk(); await syncCalendars(s, undefined, NOW, { http: fakeProviders().http, tokens });
  const failing = async (url: string) => url.includes('googleapis') ? json({ error: { message: 'Forbidden' } }, 403) : fakeProviders().http(url);
  const r = await syncCalendars(s, undefined, NOW, { http: failing as any, tokens });
  assert.deepEqual(r, { accounts: 2, failed: 1 });
  assert.match(s.accounts[0].calendarError, /permission is missing or expired \(Forbidden\).*Enable calendar/); assert.equal(s.accounts[1].calendarError, '');
  assert.equal(s.events.length, 2); // earlier data kept
});

test('calendars removed upstream are pruned with their events and tokens; clear data resets one account only', async () => {
  const s = mk(); await syncCalendars(s, undefined, NOW, { http: fakeProviders().http, tokens });
  const p = pruneAccount(s.calendars, s.events, s.calendarSync, 'g1', new Set());
  assert.deepEqual(p.calendars.map((c: any) => c.id), ['z1:zc']); assert.equal(p.events.length, 1); assert.deepEqual(p.tokens, {});
  clearCalendarData(s, 'z1');
  assert.deepEqual(s.calendars.map((c: any) => c.id), ['g1:primary']); assert.equal(s.accounts[1].calendar, false); assert.equal(s.events.length, 1);
});

test('mergeGoogle: full replaces a calendar, incremental upserts and deletes', () => {
  const ev = (id: string, cal = 'c', title = id) => ({ id, calendarId: cal, title }) as any;
  assert.deepEqual(mergeGoogle([ev('a'), ev('b'), ev('x', 'other')], 'c', { events: [ev('b', 'c', 'B2')], deletedIds: [], nextSyncToken: '', full: true }).map((e: any) => e.id), ['x', 'b']);
  const inc = mergeGoogle([ev('a'), ev('b')], 'c', { events: [ev('b', 'c', 'B2'), ev('n')], deletedIds: ['a'], nextSyncToken: '', full: false });
  assert.deepEqual(inc.map((e: any) => `${e.id}:${e.title}`), ['b:B2', 'n:n']);
});

test('zoho events are fetched in 30-day windows and deduplicated', async () => {
  const urls: string[] = [];
  const http = async (url: string) => { urls.push(url); return json({ events: [{ uid: 'same', title: 'T', dateandtime: { start: '20261118T010000Z', end: '20261118T020000Z' } }] }); };
  const cal = { id: 'z1:zc', accountId: 'z1', provider: 'zoho', providerCalendarId: 'zc', name: 'n', timeZone: 'UTC', primary: false, color: '' } as any;
  const list = await fetchZohoEvents(http, 'com', 't', cal, new Date('2026-11-01T00:00:00Z'), new Date('2027-01-15T00:00:00Z'));
  assert.equal(urls.length, 3); assert.equal(list.length, 1);
  assert.ok(decodeURIComponent(urls[0]).includes('"start":"20261101"'));
});

test('one zoho calendar failing does not fail the account', async () => {
  const state = { zoho: { dataCenter: 'com' }, calendarDisabled: [], events: [], calendars: [], calendarSync: {}, accounts: [{ id: 'z1', provider: 'zoho', calendar: true }] } as any;
  const http = async (url: string) => url.endsWith('/calendars')
    ? json({ calendars: [{ uid: 'ok', name: 'Mine' }, { uid: 'bad', name: 'Holidays' }] })
    : url.includes('/bad/') ? new Response('{}', { status: 404 }) : json({ events: [{ uid: 'e', title: 'T', dateandtime: { start: '20261118T010000Z', end: '20261118T020000Z' } }] });
  const r = await syncCalendars(state, undefined, Date.parse('2026-11-17T00:00:00Z'), { http, tokens: { google: async () => 't', zoho: async () => 't' } });
  assert.equal(r.failed, 0); assert.equal(state.accounts[0].calendarError, ''); assert.equal(state.events.length, 1);
});

test('merging a calendar sync result keeps concurrent mail edits (detached sync path)', () => {
  const base = { items: [{ id: 'i', unread: true }], accounts: [{ id: 'g1' }], pipelines: [], dismissed: [], calendars: [], events: [], calendarSync: {}, tasks: [] } as any;
  const working = structuredClone(base); working.events.push({ id: 'e' }); working.calendarSync = { c: 'S' }; working.accounts[0].calendarError = '';  working.accounts[0].calendarLastSync = 'T';
  const latest = structuredClone(base); latest.items[0].actionState = 'reviewed'; latest.tasks.push({ id: 't' });
  mergeSync(latest, base, working);
  assert.equal(latest.events.length, 1); assert.deepEqual(latest.calendarSync, { c: 'S' }); assert.equal(latest.accounts[0].calendarLastSync, 'T');
  assert.equal(latest.items[0].actionState, 'reviewed'); assert.equal(latest.tasks.length, 1);
});

test('a disabled calendar stays listed but its events and sync token are dropped; re-enabling syncs it again', async () => {
  const s = mk(); await syncCalendars(s, 'g1', NOW, { http: fakeProviders().http, tokens });
  assert.equal(s.events.length, 1);
  s.calendarDisabled = ['g1:primary'];
  const off = fakeProviders(); await syncCalendars(s, 'g1', NOW, { http: off.http, tokens });
  assert.equal(s.events.length, 0); assert.equal(s.calendarSync['g1:primary'], undefined); assert.equal(s.calendars.length, 1);
  assert.ok(!off.calls.some((c) => c.url.includes('/events')));
  s.calendarDisabled = []; await syncCalendars(s, 'g1', NOW, { http: fakeProviders().http, tokens });
  assert.equal(s.events.length, 1);
});
