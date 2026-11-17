import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { readState } from '$lib/server/aados-store';
import { messageBus, type BusEvent } from '$lib/server/message-bus';
import { toMessage } from '$lib/messages-model';

// BlueBubbles webhook (public path; authenticated by the secret token AadOS registered). Events are pushed to open
// Messages pages; nothing is stored.
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export const POST = async ({ request, url }) => {
  const secret = (await readState()).integrations.bluebubbles?.hookSecret || '';
  if (!secret || !same(url.searchParams.get('token') || '', secret)) return json({ error: 'forbidden' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const type = String(body.type || ''), data = body.data || {};
  const chatGuid = String(data.chats?.[0]?.guid || data.chatGuid || data.chat?.guid || '');
  const event: BusEvent = { type, chatGuid, ...(type === 'new-message' || type === 'updated-message' ? { message: toMessage(data, chatGuid) } : {}) };
  messageBus().emit('event', event);
  return json({ ok: true });
};
