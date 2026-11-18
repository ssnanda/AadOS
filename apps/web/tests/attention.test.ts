import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billScore, freeWindows, greeting, rankAttention, type Attention } from '../src/lib/attention.ts';

const a = (id: string, score: number, at = ''): Attention => ({ id, source: 'email', title: id, why: '', href: '/', score, at });

test('rank: most urgent first, duplicates keep the highest score, ties go to the newest', () => {
  const out = rankAttention([a('x', 50), a('y', 80)], [a('x', 70)], null, [a('z', 80, '2026-11-17T10:00:00Z')]);
  assert.deepEqual(out.map((o) => o.id), ['z', 'y', 'x']);
  assert.equal(out.find((o) => o.id === 'x')!.score, 70);
});

test('bill score rises as the due date nears; overdue is highest; unknown dates are mid', () => {
  assert.equal(billScore('2026-11-16', '2026-11-17'), 86);
  assert.ok(billScore('2026-11-18', '2026-11-17') > billScore('2026-11-21', '2026-11-17'));
  assert.equal(billScore('', '2026-11-17'), 45);
});

test('free windows between meetings (≥ 1 h) and greeting by hour', () => {
  assert.deepEqual(freeWindows([{ s: 9, e: 10 }, { s: 10.5, e: 12 }, { s: 15, e: 16 }], 8, 18), [{ s: 8, e: 9 }, { s: 12, e: 15 }, { s: 16, e: 18 }]);
  assert.deepEqual(freeWindows([], 14, 18), [{ s: 14, e: 18 }]);
  assert.equal(greeting(8), 'Good morning'); assert.equal(greeting(14), 'Good afternoon'); assert.equal(greeting(20), 'Good evening');
});
