import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefingData, briefingPrompt, findConflicts } from '../src/lib/server/ai/briefing.ts';
import { pickForTriage } from '../src/lib/server/ai/triage.ts';

const NY = 'America/New_York', NOW = Date.parse('2026-11-18T15:00:00Z');
const ev = (id: string, start: string, mins = 60, over: Record<string, unknown> = {}) => ({ id, accountId: 'g', calendarId: 'c', provider: 'google', providerEventId: id, title: id, description: '', location: '', start, end: new Date(Date.parse(start) + mins * 60_000).toISOString(), allDay: false, timeZone: NY, status: 'confirmed', ...over }) as any;

test('conflicts: overlapping timed events only; back-to-back and all-day are not conflicts', () => {
  const occ = [ev('a', '2026-11-18T15:00:00Z'), ev('b', '2026-11-18T15:30:00Z'), ev('c', '2026-11-18T16:30:00Z'), ev('d', '2026-11-18T17:30:00Z'), ev('ad', '2026-11-18', 0, { allDay: true, start: '2026-11-18', end: '2026-11-19' })].map((o) => ({ ...o, occurrenceStart: o.start }));
  assert.deepEqual(findConflicts(occ).map(([x, y]) => `${x.id}-${y.id}`), ['a-b']); // b ends exactly when c starts: back-to-back, not a conflict
});

test('briefing data is grounded in real records with stable source IDs; empty when nothing exists', () => {
  const empty = briefingData({ rows: [], events: [], disabledCalendars: [], tz: NY, now: NOW });
  assert.equal(empty.sources.length, 0); assert.ok(briefingPrompt(empty, NY).includes('(nothing scheduled or pending)'));
  const d = briefingData({ rows: [], events: [ev('Dentist', '2026-11-18T20:00:00Z'), ev('Overlap', '2026-11-18T20:30:00Z'), ev('Tomorrow thing', '2026-11-19T15:00:00Z'), ev('Hidden', '2026-11-18T18:00:00Z', 60, { calendarId: 'off' })], disabledCalendars: ['off'], tz: NY, now: NOW });
  assert.deepEqual(d.sections['Today'].map((id) => d.sources.find((s) => s.id === id)!.title), ['Dentist', 'Overlap']);
  assert.equal(d.conflicts, 1); assert.ok(d.sections['Conflicts']); assert.ok(d.sections['Tomorrow']); assert.ok(!JSON.stringify(d).includes('Hidden'));
  const p = briefingPrompt(d, NY);
  assert.ok(p.includes('[S1]') && p.includes('untrusted') && p.length < 6000);
});

test('triage selection: new, changed or failed-with-backoff messages only; old mail skipped', () => {
  const rows = [{ key: 'new', receivedAt: '2026-11-17T00:00:00Z', fp: 'a' }, { key: 'same', receivedAt: '2026-11-17T00:00:00Z', fp: 'b' }, { key: 'changed', receivedAt: '2026-11-17T00:00:00Z', fp: 'c2' },
    { key: 'failedRecent', receivedAt: '2026-11-17T00:00:00Z', fp: 'd' }, { key: 'failedOld', receivedAt: '2026-11-17T00:00:00Z', fp: 'e' }, { key: 'gaveUp', receivedAt: '2026-11-17T00:00:00Z', fp: 'f' }, { key: 'ancient', receivedAt: '2026-01-01T00:00:00Z', fp: 'g' }];
  const done = new Map([['same', { fingerprint: 'b', status: 'done', attempts: 1, updatedAt: '2026-11-18T00:00:00Z' }], ['changed', { fingerprint: 'c1', status: 'done', attempts: 1, updatedAt: '2026-11-18T00:00:00Z' }],
    ['failedRecent', { fingerprint: 'd', status: 'failed', attempts: 1, updatedAt: new Date(NOW - 60_000).toISOString() }], ['failedOld', { fingerprint: 'e', status: 'failed', attempts: 1, updatedAt: new Date(NOW - 3600_000).toISOString() }], ['gaveUp', { fingerprint: 'f', status: 'failed', attempts: 3, updatedAt: '2026-11-01T00:00:00Z' }]]);
  assert.deepEqual(pickForTriage(rows, done, NOW).map((r) => r.key), ['new', 'changed', 'failedOld']);
  assert.equal(pickForTriage(rows, done, NOW, 1).length, 1);
});
