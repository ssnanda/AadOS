import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonth, dueBadge, duePayload, dueShort, loadTone, recurrenceSummary, stageOf } from '../src/lib/asana-model.ts';

test('stages from My Tasks section names', () => {
  assert.equal(stageOf('Recently assigned'), 'incoming');
  assert.equal(stageOf(' To Do '), 'todo');
  assert.equal(stageOf('In progress'), 'doing');
  assert.equal(stageOf('Completed'), 'done');
  assert.equal(stageOf('Someday'), null);
});

test('recurrence summaries match the Asana wording', () => {
  assert.equal(recurrenceSummary({ type: 'weekly', data: { frequency: 1, days_of_week: [5, 1, 2, 3, 4] } }), 'Repeats weekly on Mon, Tue, Wed, Thu, Fri');
  assert.equal(recurrenceSummary({ type: 'monthly', data: { frequency: 1, date: 15 } }), 'Repeats monthly on day 15');
  assert.equal(recurrenceSummary({ type: 'monthly', data: { frequency: 1, days_of_week: [2], nth_weekday: 1 } }), 'Repeats monthly on the 1st Tuesday');
  assert.equal(recurrenceSummary({ type: 'yearly', data: { frequency: 1, month: 10, date: 15 } }), 'Repeats yearly on October 15');
  assert.equal(recurrenceSummary({ type: 'never', data: null }), '');
});

test('due badges and short labels', () => {
  assert.deepEqual(dueBadge({ dueOn: '2026-11-09', dueAt: null }, '2026-11-17'), { text: '8D OVERDUE', tone: 'overdue' });
  assert.deepEqual(dueBadge({ dueOn: '2026-11-17', dueAt: '2026-11-18T01:00:00.000Z' }, '2026-11-17', 'America/New_York'), { text: 'DUE TODAY · 8:00 PM', tone: 'today' });
  assert.equal(dueShort({ dueOn: '2026-11-16', dueAt: null }, '2026-11-17').text, 'Yesterday');
  assert.equal(loadTone(0), 'zero'); assert.equal(loadTone(3), 'light'); assert.equal(loadTone(6), 'busy'); assert.equal(loadTone(14), 'full');
});

test('due payload converts local day+time to a UTC instant; next month clamps', () => {
  assert.deepEqual(duePayload('2026-11-17', '19:00', 'America/New_York'), { due_at: '2026-11-18T00:00:00.000Z' });
  assert.deepEqual(duePayload('2026-11-17', '', 'America/New_York'), { due_on: '2026-11-17', due_at: null });
  assert.deepEqual(duePayload(null, ''), { due_on: null, due_at: null });
  assert.equal(addMonth('2026-01-31'), '2026-02-28');
  assert.equal(addMonth('2026-11-17'), '2026-12-17');
});
