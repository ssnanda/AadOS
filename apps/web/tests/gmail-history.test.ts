import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldHistory } from '../src/lib/server/gmail-history.ts';

test('folds additions, unread label changes and deletions across pages', () => {
  const d = foldHistory([
    { historyId: '10', history: [{ messagesAdded: [{ message: { id: 'a', labelIds: ['INBOX', 'UNREAD'] } }, { message: { id: 'b', labelIds: ['INBOX'] } }] }] },
    { historyId: '12', history: [{ labelsRemoved: [{ message: { id: 'a' }, labelIds: ['UNREAD'] }] }, { labelsAdded: [{ message: { id: 'c' }, labelIds: ['UNREAD'] }] }, { messagesDeleted: [{ message: { id: 'b' } }] }] }
  ]);
  assert.deepEqual(d.added, ['a']);
  assert.deepEqual(d.unread, { a: false, c: true });
  assert.equal(d.historyId, '12');
});
test('empty history keeps the last historyId', () => {
  assert.equal(foldHistory([{ historyId: '5' }, {}]).historyId, '5');
});
