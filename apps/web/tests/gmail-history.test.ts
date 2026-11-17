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
test('with a label: gaining it adds, losing it / trash / spam / delete removes; last event wins', () => {
  const d = foldHistory([{ historyId: '20', history: [
    { labelsRemoved: [{ message: { id: 'moved' }, labelIds: ['INBOX'] }] },
    { labelsAdded: [{ message: { id: 'trashed' }, labelIds: ['TRASH'] }] },
    { labelsAdded: [{ message: { id: 'spam' }, labelIds: ['SPAM'] }] },
    { messagesDeleted: [{ message: { id: 'gone' } }] },
    { labelsAdded: [{ message: { id: 'back' }, labelIds: ['INBOX'] }] },
    { labelsRemoved: [{ message: { id: 'flip' }, labelIds: ['INBOX'] }] },
    { labelsAdded: [{ message: { id: 'flip' }, labelIds: ['INBOX'] }] }
  ] }], 'INBOX');
  assert.deepEqual(d.added.sort(), ['back', 'flip']);
  assert.deepEqual(d.removed.sort(), ['gone', 'moved', 'spam', 'trashed']);
});
test('without a label only real deletions are removals', () => {
  const d = foldHistory([{ history: [{ labelsRemoved: [{ message: { id: 'x' }, labelIds: ['INBOX'] }] }, { messagesDeleted: [{ message: { id: 'y' } }] }] }]);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, ['y']);
});
