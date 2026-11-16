import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, bucketByDay, describeRecurrence, isDate, localParts, rangeUtc, shiftDate, todayIn, viewDays } from '../src/lib/calendar/view.ts';
import { agenda, findMeetingUrl, type CalEvent } from '../src/lib/calendar/model.ts';
import { mapEvent, mapCalendar } from '../src/lib/calendar/google.ts';
import { mapZohoEvent, mapZohoCalendar } from '../src/lib/calendar/zoho.ts';

const NY = 'America/New_York';
const ev = (over: Partial<CalEvent>): CalEvent => ({ id: 'e', accountId: 'a', calendarId: 'c', provider: 'google', providerEventId: 'e', title: 'T', description: '', location: '', start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:00:00.000Z', allDay: false, timeZone: NY, status: 'confirmed', ...over });

test('view days: month is whole weeks, week is 7 days from week start, agenda is 30 days', () => {
  const month = viewDays('month', '2026-11-16');
  assert.equal(month[0], '2026-11-01'); assert.equal(month.at(-1), '2026-12-05'); assert.equal(month.length % 7, 0);
  assert.deepEqual(viewDays('week', '2026-11-18'), ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
  assert.equal(viewDays('week', '2026-11-18', 1)[0], '2026-11-16'); // Monday start
  assert.deepEqual(viewDays('day', '2026-11-18'), ['2026-11-18']);
  assert.equal(viewDays('agenda', '2026-11-18').length, 30);
  assert.equal(viewDays('month', '2026-02-10').length, 28); // Feb 2026 starts on Sunday: exactly 4 weeks
});

test('navigation and date helpers', () => {
  assert.equal(shiftDate('month', '2026-01-31', 1), '2026-02-01'); assert.equal(shiftDate('month', '2026-01-15', -1), '2025-12-01');
  assert.equal(shiftDate('week', '2026-11-16', 1), '2026-11-23'); assert.equal(shiftDate('day', '2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01'); assert.equal(isDate('2026-02-30'), false); assert.equal(isDate('2026-02-28'), true);
  assert.equal(todayIn(NY, Date.parse('2026-11-17T03:00:00Z')), '2026-11-16'); // still the 16th in New York
});

test('range is DST-safe: the fall-back day is 25 hours, spring-forward 23', () => {
  const fall = rangeUtc(['2026-11-01'], NY); assert.equal((Date.parse(fall.to) - Date.parse(fall.from)) / 3600_000, 25);
  const spring = rangeUtc(['2026-03-08'], NY); assert.equal((Date.parse(spring.to) - Date.parse(spring.from)) / 3600_000, 23);
  assert.equal(rangeUtc(['2026-11-16'], NY).from, '2026-11-16T05:00:00.000Z');
});

test('bucketing uses the viewer zone: a late-evening UTC event is the same local day; all-day first', () => {
  const late = ev({ id: 'late', title: 'Late', start: '2026-11-17T02:30:00.000Z', end: '2026-11-17T03:30:00.000Z' }); // 9:30pm on the 16th in NY
  const allDay = ev({ id: 'ad', title: 'Holiday', allDay: true, start: '2026-11-16', end: '2026-11-17' });
  const days = ['2026-11-16', '2026-11-17'];
  const { from, to } = rangeUtc(days, NY);
  const b = bucketByDay(agenda([late, allDay], from, to), days, NY);
  assert.deepEqual(b['2026-11-16'].map((i) => i.title), ['Holiday', 'Late']); assert.equal(b['2026-11-17'].length, 0);
  assert.equal(b['2026-11-16'][1].minutes, 21 * 60 + 30);
  assert.deepEqual(localParts('2026-11-17T02:30:00.000Z', 'UTC'), { date: '2026-11-17', minutes: 150 });
});

test('multi-day events appear on each day with start/middle/end; midnight end does not spill', () => {
  const trip = ev({ id: 'trip', title: 'Trip', allDay: true, start: '2026-11-16', end: '2026-11-19' });
  const overnight = ev({ id: 'on', title: 'Flight', start: '2026-11-17T03:00:00.000Z', end: '2026-11-17T15:00:00.000Z' }); // 10pm 16th -> 10am 17th NY
  const tillMidnight = ev({ id: 'm', title: 'Party', start: '2026-11-17T01:00:00.000Z', end: '2026-11-17T05:00:00.000Z' }); // 8pm -> midnight NY
  const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'];
  const { from, to } = rangeUtc(days, NY);
  const b = bucketByDay(agenda([trip, overnight, tillMidnight], from, to), days, NY);
  const parts = (d: string, t: string) => b[d].find((i) => i.title === t)?.part;
  assert.deepEqual(days.map((d) => parts(d, 'Trip')), ['start', 'middle', 'end', undefined]);
  assert.deepEqual([parts('2026-11-16', 'Flight'), parts('2026-11-17', 'Flight')], ['start', 'end']);
  assert.deepEqual([parts('2026-11-16', 'Party'), parts('2026-11-17', 'Party')], ['single', undefined]);
});

test('recurrence summary and meeting links', () => {
  assert.equal(describeRecurrence(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE']), 'Weekly on Mon, Wed');
  assert.equal(describeRecurrence(['RRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=5']), 'Every 2 months, 5 times');
  assert.equal(describeRecurrence(['RRULE:FREQ=DAILY;UNTIL=20261231T000000Z']), 'Daily, until 2026-12-31');
  assert.equal(describeRecurrence(undefined), '');
  assert.equal(findMeetingUrl('Room 4', 'Join: https://zoom.us/j/123?pwd=x now'), 'https://zoom.us/j/123?pwd=x');
  assert.equal(findMeetingUrl('https://example.com/agenda'), '');
});

test('provider mapping: organizer, attendees, meeting link (Google conference data; Zoho documented shape)', () => {
  const gc = mapCalendar({ id: 'p', summary: 'Me', timeZone: NY }, 'g1');
  const g = mapEvent({ id: 'x', summary: 'Sync', htmlLink: 'https://calendar.google.com/x', start: { dateTime: '2026-11-16T10:00:00-05:00' }, end: { dateTime: '2026-11-16T11:00:00-05:00' }, organizer: { email: 'boss@x.com', displayName: 'Boss' },
    attendees: [{ email: 'me@x.com', responseStatus: 'accepted' }, { email: 'room@x.com', resource: true }], conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:1' }, { entryPointType: 'video', uri: 'https://meet.google.com/abc' }] } }, gc)!;
  assert.equal(g.organizer, 'Boss <boss@x.com>'); assert.deepEqual(g.attendees, [{ email: 'me@x.com', status: 'accepted' }]); assert.equal(g.meetingUrl, 'https://meet.google.com/abc'); assert.equal(g.htmlLink, 'https://calendar.google.com/x');
  const zc = mapZohoCalendar({ uid: 'u', name: 'user', timezone: 'Asia/Calcutta', color: '#8cbf40', isdefault: true }, 'z1');
  assert.equal(zc.color, '#8cbf40'); assert.equal(zc.primary, true);
  const z = mapZohoEvent({ uid: '05bc@zoho.com', title: 'Teast af', dateandtime: { start: '20170718T205000+0530', end: '20170718T224500+0530', timezone: 'Asia/Calcutta' }, isallday: false, organizer: 'rebecca@zylker.com',
    attendees: [{ email: 'a@x.com', status: 'DECLINED' }], rrule: 'FREQ=WEEKLY;UNTIL=20170830T100100Z;INTERVAL=1;BYDAY=MO,WE,SA', location: 'https://meeting.zoho.com/join?key=1' }, zc)!;
  assert.equal(z.start, '2017-07-18T15:20:00.000Z'); assert.equal(z.organizer, 'rebecca@zylker.com'); assert.deepEqual(z.attendees, [{ email: 'a@x.com', status: 'declined' }]);
  assert.deepEqual(z.recurrence, ['RRULE:FREQ=WEEKLY;UNTIL=20170830T100100Z;INTERVAL=1;BYDAY=MO,WE,SA']); assert.equal(z.meetingUrl, 'https://meeting.zoho.com/join?key=1');
});
