import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agenda, expandEvent, zonedToUtc, zoneOffset, utcToZoned, validZone, type CalEvent } from '../src/lib/calendar/model.ts';

const ev = (over: Partial<CalEvent> = {}): CalEvent => ({ id: 'e', accountId: 'g1', calendarId: 'c1', provider: 'google', providerEventId: 'e1', title: 'Standup', description: '', location: '', start: '2026-11-02T14:00:00.000Z', end: '2026-11-02T14:30:00.000Z', allDay: false, timeZone: 'America/New_York', status: 'confirmed', ...over });
const starts = (list: { start: string }[]) => list.map((o) => o.start);
const range = (a: string, b: string) => [Date.parse(a), Date.parse(b)] as const;

test('time zone helpers', () => {
  assert.equal(validZone('America/New_York'), true); assert.equal(validZone('Not/AZone'), false);
  assert.equal(zoneOffset(Date.parse('2026-07-01T12:00:00Z'), 'America/New_York'), -4 * 3600_000);
  assert.equal(zoneOffset(Date.parse('2026-12-01T12:00:00Z'), 'America/New_York'), -5 * 3600_000);
  assert.equal(new Date(zonedToUtc(2026, 3, 8, 9, 0, 0, 'America/New_York')).toISOString(), '2026-03-08T13:00:00.000Z'); // after spring-forward (EDT)
  assert.deepEqual(utcToZoned(Date.parse('2026-11-02T14:00:00Z'), 'America/New_York'), { y: 2026, mo: 11, d: 2, h: 9, mi: 0, s: 0 });
});

test('single event overlap', () => {
  assert.equal(expandEvent(ev(), ...range('2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z')).length, 1);
  assert.equal(expandEvent(ev(), ...range('2026-11-03T00:00:00Z', '2026-11-04T00:00:00Z')).length, 0);
  assert.equal(expandEvent(ev({ status: 'cancelled' }), ...range('2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z')).length, 0);
});

test('weekly BYDAY keeps local wall time across the DST change (9am New York)', () => {
  // Mon 2026-11-02 09:00 EST. DST ends Sun 2026-11-01 -> already EST; use March: starts Mon 2026-03-02 09:00 EST, DST begins 2026-03-08.
  const e = ev({ start: '2026-03-02T14:00:00.000Z', end: '2026-03-02T14:30:00.000Z', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'] });
  const got = starts(expandEvent(e, ...range('2026-03-02T00:00:00Z', '2026-03-12T00:00:00Z')));
  assert.deepEqual(got, ['2026-03-02T14:00:00.000Z', '2026-03-04T14:00:00.000Z', '2026-03-09T13:00:00.000Z', '2026-03-11T13:00:00.000Z']);
});

test('COUNT, UNTIL, INTERVAL, EXDATE', () => {
  const daily = ev({ recurrence: ['RRULE:FREQ=DAILY;COUNT=3'] });
  assert.equal(expandEvent(daily, ...range('2026-11-01T00:00:00Z', '2026-12-31T00:00:00Z')).length, 3);
  const until = ev({ recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261104T235959Z'] });
  assert.equal(expandEvent(until, ...range('2026-11-01T00:00:00Z', '2026-12-31T00:00:00Z')).length, 3);
  const biweekly = ev({ recurrence: ['RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3'] });
  assert.deepEqual(starts(expandEvent(biweekly, ...range('2026-11-01T00:00:00Z', '2027-02-01T00:00:00Z'))), ['2026-11-02T14:00:00.000Z', '2026-11-16T14:00:00.000Z', '2026-11-30T14:00:00.000Z']);
  const ex = ev({ recurrence: ['RRULE:FREQ=DAILY;COUNT=3', 'EXDATE;TZID=America/New_York:20261103T090000'] });
  assert.deepEqual(starts(expandEvent(ex, ...range('2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z'))), ['2026-11-02T14:00:00.000Z', '2026-11-04T14:00:00.000Z']);
});

test('monthly: day-of-month skips short months; ordinal weekday; last Friday', () => {
  const m31 = ev({ start: '2026-01-31T15:00:00.000Z', end: '2026-01-31T16:00:00.000Z', recurrence: ['RRULE:FREQ=MONTHLY;COUNT=4'] });
  assert.deepEqual(starts(expandEvent(m31, ...range('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'))).map((s) => s.slice(0, 10)), ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
  const second = ev({ start: '2026-11-10T15:00:00.000Z', end: '2026-11-10T16:00:00.000Z', recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3'] });
  assert.deepEqual(starts(expandEvent(second, ...range('2026-11-01T00:00:00Z', '2027-03-01T00:00:00Z'))).map((s) => s.slice(0, 10)), ['2026-11-10', '2026-12-08', '2027-01-12']);
  const last = ev({ start: '2026-11-27T15:00:00.000Z', end: '2026-11-27T16:00:00.000Z', recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=2'] });
  assert.deepEqual(starts(expandEvent(last, ...range('2026-11-01T00:00:00Z', '2027-03-01T00:00:00Z'))).map((s) => s.slice(0, 10)), ['2026-11-27', '2026-12-25']);
});

test('yearly birthday as all-day; Feb 29 skips non-leap years', () => {
  const b = ev({ allDay: true, start: '2026-11-20', end: '2026-11-21', timeZone: 'UTC', recurrence: ['RRULE:FREQ=YEARLY'] });
  assert.deepEqual(starts(expandEvent(b, ...range('2026-01-01T00:00:00Z', '2029-01-01T00:00:00Z'))), ['2026-11-20', '2027-11-20', '2028-11-20']);
  const leap = ev({ allDay: true, start: '2024-02-29', end: '2024-03-01', timeZone: 'UTC', recurrence: ['RRULE:FREQ=YEARLY'] });
  assert.deepEqual(starts(expandEvent(leap, ...range('2025-01-01T00:00:00Z', '2029-01-01T00:00:00Z'))), ['2028-02-29']);
});

test('unified agenda: edited and cancelled instances, accounts, sorting, dedupe', () => {
  const master = ev({ recurrence: ['RRULE:FREQ=DAILY;COUNT=4'] });
  const moved = ev({ id: 'm', providerEventId: 'e1_20261103', recurringEventId: 'e1', originalStart: '2026-11-03T14:00:00.000Z', start: '2026-11-03T18:00:00.000Z', end: '2026-11-03T18:30:00.000Z', title: 'Standup (moved)' });
  const cancelled = ev({ id: 'c', providerEventId: 'e1_20261104', recurringEventId: 'e1', originalStart: '2026-11-04T14:00:00.000Z', status: 'cancelled' });
  const other = ev({ id: 'z', accountId: 'z1', provider: 'zoho', calendarId: 'zc', providerEventId: 'z1', title: 'Dentist', start: '2026-11-02T20:00:00.000Z', end: '2026-11-02T21:00:00.000Z' });
  const list = agenda([master, moved, cancelled, other, other], '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z');
  assert.deepEqual(list.map((o) => `${o.start.slice(0, 13)} ${o.title}`), ['2026-11-02T14 Standup', '2026-11-02T20 Dentist', '2026-11-03T18 Standup (moved)', '2026-11-05T14 Standup']);
  assert.equal(agenda([master, other], '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z', { accountId: 'z1' }).length, 1);
});
