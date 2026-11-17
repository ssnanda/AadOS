import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressKey, isUnread, preview, prettyAddress, toChat, toMessage } from '../src/lib/messages-model.ts';

test('address keys match contacts regardless of formatting', () => {
  assert.equal(addressKey('+1 (980) 306-8308'), '9803068308');
  assert.equal(addressKey('9803068308'), '9803068308');
  assert.equal(addressKey('Me@Example.com'), 'me@example.com');
  assert.equal(prettyAddress('+19803068308'), '(980) 306-8308');
  assert.equal(prettyAddress('me@example.com'), 'me@example.com');
});

test('chats take the group name, else contact names, else pretty numbers', () => {
  const names = new Map([['9803068308', 'Anad Nanda']]);
  assert.equal(toChat({ guid: 'g1', displayName: 'Family', participants: [{ address: '+19803068308' }, { address: 'x@y.com' }] }, names).title, 'Family');
  const dm = toChat({ guid: 'g2', participants: [{ address: '+19803068308' }] }, names);
  assert.equal(dm.title, 'Anad Nanda'); assert.equal(dm.group, false);
  assert.equal(toChat({ guid: 'g3', participants: [{ address: '+17045551234' }] }, new Map()).title, '(704) 555-1234');
});

test('messages, unread and previews', () => {
  const m = toMessage({ guid: 'm1', text: 'Hi', isFromMe: false, dateCreated: 2000, handle: { address: '+19803068308' }, attachments: [{ guid: 'a1', transferName: 'IMG.jpg', mimeType: 'image/jpeg', totalBytes: 10 }] }, 'g2');
  assert.equal(m.sender, '+19803068308'); assert.equal(m.attachments[0].name, 'IMG.jpg');
  const chat = { guid: 'g2', title: 't', participants: [], group: false, last: m, sms: false };
  assert.equal(isUnread(chat, {}), true); assert.equal(isUnread(chat, { g2: 3000 }), false);
  // Already read on the phone/Mac (dateRead) → not unread here either.
  assert.equal(isUnread({ ...chat, last: toMessage({ guid: 'm2', text: 'x', dateCreated: 2000, dateRead: 2500, handle: { address: 'a' } }, 'g2') }, {}), false);
  assert.equal(toChat({ guid: 'SMS;-;+17325551234', participants: [{ address: '+17325551234' }] }, new Map()).sms, true);
  assert.equal(preview({ ...m, text: '' }), '📎 IMG.jpg');
});
