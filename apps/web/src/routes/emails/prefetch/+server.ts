import { json } from '@sveltejs/kit';
import { warmUnread } from '$lib/server/email-bodies';

// Starts the background warm-up of unread email bodies (text/HTML only, nothing marked read) and returns at once.
export const POST = async () => {
  warmUnread();
  return json({ ok: true });
};
