import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addresses, buildMime, encodeHeader, quote, recipients, subjectFor, threading, unsubscribeFromHeader, unsubscribeFromHtml, validAddressList } from '../src/lib/server/compose.ts';

const h = { from: 'Ann <ann@x.com>', to: 'Me <me@mine.com>, bob@x.com', cc: 'carol@x.com, ME@mine.com', subject: 'Plans', date: 'Mon, 16 Nov 2026 10:00:00 -0500', 'message-id': '<abc@x.com>', references: '<root@x.com>' };

test('recipients: reply, reply all (never yourself), reply-to, own sent mail, forward', () => {
  assert.deepEqual(recipients('reply', h, 'me@mine.com'), { to: ['ann@x.com'], cc: [] });
  assert.deepEqual(recipients('replyAll', h, 'me@mine.com'), { to: ['ann@x.com'], cc: ['bob@x.com', 'carol@x.com'] });
  assert.deepEqual(recipients('reply', { ...h, 'reply-to': 'lists@x.com' }, 'me@mine.com').to, ['lists@x.com']);
  assert.deepEqual(recipients('reply', { from: 'me@mine.com', to: 'dan@y.com' }, 'me@mine.com').to, ['dan@y.com']);
  assert.deepEqual(recipients('forward', h, 'me@mine.com'), { to: [], cc: [] });
  assert.deepEqual(addresses('A <A@X.com>, a@x.com'), ['a@x.com']);
  assert.equal(validAddressList('a@x.com, Bob <b@y.org>'), true); assert.equal(validAddressList('nope'), false);
});

test('subjects, quoting, threading', () => {
  assert.equal(subjectFor('reply', 'Plans'), 'Re: Plans'); assert.equal(subjectFor('reply', 'RE: Plans'), 'RE: Plans');
  assert.equal(subjectFor('forward', 'Plans'), 'Fwd: Plans'); assert.equal(subjectFor('forward', 'Fw: x'), 'Fw: x');
  assert.match(quote('reply', h, 'line 1\nline 2'), /wrote:\n> line 1\n> line 2$/);
  assert.match(quote('forward', h, 'body'), /Forwarded message[\s\S]*From: Ann <ann@x.com>[\s\S]*body$/);
  assert.deepEqual(threading(h), { inReplyTo: '<abc@x.com>', references: '<root@x.com> <abc@x.com>' });
});

test('MIME: headers, UTF-8 subject, base64 body, attachments, no header injection', () => {
  const plain = buildMime({ from: 'me@mine.com', to: ['ann@x.com'], subject: 'Re: Café', text: 'Merci ✓', inReplyTo: '<abc@x.com>', references: '<abc@x.com>', date: new Date('2026-11-17T00:00:00Z') });
  assert.match(plain, /^From: me@mine.com\r\nTo: ann@x.com\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(plain, /In-Reply-To: <abc@x.com>/);
  assert.equal(Buffer.from(plain.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString(), 'Merci ✓');
  const multi = buildMime({ from: 'me@mine.com', to: ['ann@x.com'], subject: 'Fwd: x', text: 'see attached', attachments: [{ filename: 'a"b.pdf', mime: 'application/pdf', data: Buffer.from('%PDF') }], boundary: 'BB' });
  assert.match(multi, /Content-Type: multipart\/mixed; boundary="BB"/); assert.match(multi, /filename="a_b.pdf"/); assert.match(multi, /--BB--/);
  assert.throws(() => buildMime({ from: 'me@mine.com', to: ['ann@x.com'], subject: 'x\r\nBcc: evil@x.com', text: '' }), /line breaks/);
  assert.throws(() => buildMime({ from: 'me@mine.com', to: [], subject: 'x', text: '' }), /recipient/);
  assert.equal(encodeHeader('plain'), 'plain');
});

test('unsubscribe: header (prefer https), html fallback', () => {
  assert.deepEqual(unsubscribeFromHeader('<mailto:u@x.com?subject=unsub>, <https://x.com/u?id=1>'), { url: 'https://x.com/u?id=1', mailto: 'mailto:u@x.com?subject=unsub' });
  assert.deepEqual(unsubscribeFromHeader(undefined), { url: '', mailto: '' });
  assert.equal(unsubscribeFromHtml('<p><a href="https://x.com/home">Home</a> <a href="https://x.com/prefs?a=1&amp;b=2">Unsubscribe</a></p>'), 'https://x.com/prefs?a=1&b=2');
  assert.equal(unsubscribeFromHtml('<a href="javascript:alert(1)">unsubscribe</a>'), '');
});
