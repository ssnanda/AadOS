import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listCalendars, mapEvent, syncCalendar, mapCalendar } from '../src/lib/calendar/google.ts';
import { parseZohoTime, mapZohoEvent, mapZohoCalendar } from '../src/lib/calendar/zoho.ts';
import { expandEvent } from '../src/lib/calendar/model.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const cal = mapCalendar({ id: 'primary@x.com', summary: 'Me', timeZone: 'America/New_York', primary: true }, 'gmail-a');

test('google: calendar list paginates; requests are read-only GETs with a bearer token', async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const f = async (url: string, init?: RequestInit) => { seen.push({ url, init }); return url.includes('pageToken=p2') ? json(200, { items: [{ id: 'b', summary: 'B' }] }) : json(200, { items: [{ id: 'a', summary: 'A', primary: true }], nextPageToken: 'p2' }); };
  const list = await listCalendars(f, 'TOK', 'gmail-a');
  assert.deepEqual(list.map((c) => c.providerCalendarId), ['a', 'b']);
  assert.ok(seen.every((s) => !s.init?.method || s.init.method === 'GET') && (seen[0].init!.headers as any).Authorization === 'Bearer TOK');
});

test('google: event mapping (timed, all-day, recurring master, edited instance, cancelled)', () => {
  const timed = mapEvent({ id: 'e1', summary: 'Lunch', start: { dateTime: '2026-11-02T12:00:00-05:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-11-02T13:00:00-05:00' }, recurrence: ['RRULE:FREQ=WEEKLY'] }, cal)!;
  assert.equal(timed.start, '2026-11-02T17:00:00.000Z'); assert.equal(timed.timeZone, 'America/New_York'); assert.deepEqual(timed.recurrence, ['RRULE:FREQ=WEEKLY']);
  const allDay = mapEvent({ id: 'e2', summary: 'Trip', start: { date: '2026-11-05' }, end: { date: '2026-11-07' } }, cal)!;
  assert.equal(allDay.allDay, true); assert.equal(allDay.end, '2026-11-07');
  const inst = mapEvent({ id: 'e1_x', status: 'cancelled', recurringEventId: 'e1', originalStartTime: { dateTime: '2026-11-09T12:00:00-05:00' } }, cal)!;
  assert.equal(inst.status, 'cancelled'); assert.equal(inst.originalStart, '2026-11-09T17:00:00.000Z');
  assert.equal(mapEvent({ id: 'gone', status: 'cancelled' }, cal)!.status, 'cancelled');
  assert.equal(mapEvent({ id: 'bad', summary: 'no times' }, cal), null);
});

test('google: incremental sync uses syncToken; 410 falls back to a full sync; deletions reported', async () => {
  const urls: string[] = [];
  const f = async (url: string) => {
    urls.push(url);
    if (url.includes('syncToken=old')) return json(410, { error: { message: 'Gone' } });
    return json(200, { items: [{ id: 'e1', summary: 'A', start: { dateTime: '2026-11-02T12:00:00Z' }, end: { dateTime: '2026-11-02T13:00:00Z' } }, { id: 'e2', status: 'cancelled' }], nextSyncToken: 'fresh' });
  };
  const r = await syncCalendar(f, 'T', cal, 'old', '2026-01-01T00:00:00Z');
  assert.equal(r.full, true); assert.equal(r.nextSyncToken, 'fresh'); assert.equal(r.events.length, 1); assert.deepEqual(r.deletedIds, ['gmail-a:e2']);
  assert.ok(urls[0].includes('syncToken=old') && !urls[0].includes('timeMin')); assert.ok(urls[1].includes('timeMin') && !urls[1].includes('syncToken'));
  const inc = await syncCalendar(async () => json(200, { items: [], nextSyncToken: 'n2' }), 'T', cal, 'fresh');
  assert.equal(inc.full, false); assert.equal(inc.nextSyncToken, 'n2');
});

test('google: other HTTP errors propagate', async () => {
  await assert.rejects(syncCalendar(async () => json(403, { error: { message: 'Forbidden' } }), 'T', cal), /Forbidden/);
});

test('zoho: timestamp formats and event mapping', () => {
  assert.deepEqual(parseZohoTime('20261102T140000Z'), { iso: '2026-11-02T14:00:00.000Z', allDay: false });
  assert.deepEqual(parseZohoTime('20261102T090000-0500'), { iso: '2026-11-02T14:00:00.000Z', allDay: false });
  assert.deepEqual(parseZohoTime('20261102'), { iso: '2026-11-02', allDay: true });
  assert.equal(parseZohoTime('garbage'), null);
  const zc = mapZohoCalendar({ uid: 'u1', name: 'Home', timezone: 'Asia/Kolkata' }, 'zoho-a');
  const ev = mapZohoEvent({ uid: 'z1', title: 'Gym', dateandtime: { start: '20261102T010000Z', end: '20261102T020000Z', timezone: 'Asia/Kolkata' }, rrule: ['FREQ=DAILY;COUNT=2'] }, zc)!;
  assert.deepEqual(ev.recurrence, ['RRULE:FREQ=DAILY;COUNT=2']);
  assert.equal(expandEvent(ev, Date.parse('2026-11-01T00:00:00Z'), Date.parse('2026-11-10T00:00:00Z')).length, 2);
  assert.equal(mapZohoEvent({ uid: 'x', title: 'no time' }, zc), null);
});
