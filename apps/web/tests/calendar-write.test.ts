import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleBody, normalize, zohoEventData } from '../src/lib/calendar/write.ts';
import { zohoUid } from '../src/lib/calendar/zoho.ts';

const base = { title: 'Dentist', description: '', location: '', allDay: false, startDate: '2026-11-18', startTime: '09:00', endDate: '2026-11-18', endTime: '10:00', timeZone: 'America/New_York' };

test('timed events convert the owner zone to UTC; all-day end becomes exclusive', () => {
  assert.deepEqual(normalize(base), { start: '2026-11-18T14:00:00.000Z', end: '2026-11-18T15:00:00.000Z' });
  assert.deepEqual(normalize({ ...base, allDay: true, endDate: '2026-11-19' }), { start: '2026-11-18', end: '2026-11-20' });
  assert.throws(() => normalize({ ...base, endTime: '08:00' }), /end after/);
  assert.throws(() => normalize({ ...base, title: ' ' }), /title/);
});

test('provider payloads', () => {
  assert.deepEqual(googleBody(base).start, { dateTime: '2026-11-18T14:00:00.000Z', timeZone: 'America/New_York' });
  assert.deepEqual(googleBody({ ...base, allDay: true }).end, { date: '2026-11-19' });
  assert.deepEqual(zohoEventData(base, 'e1').dateandtime, { timezone: 'America/New_York', start: '20261118T140000Z', end: '20261118T150000Z' });
  assert.equal(zohoEventData(base, 'e1').etag, 'e1');
  assert.deepEqual(zohoEventData({ ...base, allDay: true }).dateandtime, { timezone: 'America/New_York', start: '20261118', end: '20261118' });
});

test('zoho calendar uids keep their base64 padding literal', () => {
  assert.equal(zohoUid('gbg4V1UfTNanMX_72qq1_g=='), 'gbg4V1UfTNanMX_72qq1_g==');
  assert.equal(zohoUid('a/b c'), 'a%2Fb%20c');
});
