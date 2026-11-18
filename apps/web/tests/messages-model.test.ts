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

test('brands from notification texts, and grouping suggestions', async () => {
  const { brandOf, brandKey, suggestGroups } = await import('../src/lib/messages-model.ts');
  assert.equal(brandOf('Atrium Health: Thank you for your payment of $18.89.'), 'Atrium Health');
  assert.equal(brandOf('Hi Anad, this is Atrium Health reaching out'), 'Atrium Health');
  assert.equal(brandOf("Hi, it's AT&T. As a reminder, network…"), 'AT&T');
  assert.equal(brandOf('Hello. We are attempting to get a vacant lot'), null);
  assert.equal(brandKey('Atrium notifications'), brandKey('Atrium Health'));
  const chat = (guid: string, addr: string, text: string) => ({ guid, title: addr, participants: [addr], group: false, sms: true, last: { guid: `${guid}m`, chatGuid: guid, text, fromMe: false, sender: addr, at: 1, attachments: [], error: false, read: false } });
  const chats = [chat('a', '604931(smsft)', 'Atrium Health: statement'), chat('b', '69871(smsft)', 'Atrium Health: flu shot'), chat('c', '+19803726532', 'Hi Anad, this is Atrium Health reaching out'), chat('d', '+12312016624', 'Is your lot available?')];
  const s = suggestGroups(chats, [], {});
  assert.equal(s.length, 1); assert.equal(s[0].name, 'Atrium Health notifications'); assert.equal(s[0].guids.length, 3);
  const existing = suggestGroups(chats, [{ id: 'g', name: 'Atrium notifications', addresses: ['604931'] }], {});
  assert.equal(existing[0].groupId, 'g'); assert.deepEqual(existing[0].guids.sort(), ['b', 'c']);
});

test('spam replies: stop-solicitation moves to Spam and reports to 7726 by default', async () => {
  const { DEFAULT_TEMPLATES, isSpamReply, matchSpamTemplate, reportsSpam, isSmsChat } = await import('../src/lib/messages-model.ts');
  const sent = DEFAULT_TEMPLATES[0].text.replace('immediately.', 'immediately!');
  assert.equal(isSpamReply(sent, DEFAULT_TEMPLATES), true);
  assert.equal(reportsSpam(matchSpamTemplate(sent, DEFAULT_TEMPLATES)!), true);
  assert.equal(isSpamReply('Sounds good, see you then!', DEFAULT_TEMPLATES), false);
  assert.equal(isSpamReply(sent, [{ ...DEFAULT_TEMPLATES[0], spam: false }]), false);
  assert.equal(isSmsChat({ guid: 'any;-;+19102422985', participants: [{ address: '+19102422985', service: 'SMS' }] }), true);
  assert.equal(isSmsChat({ guid: 'iMessage;-;+19102422985' }), false);
});
