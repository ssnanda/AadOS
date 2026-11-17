import { error } from '@sveltejs/kit';
import { attachment, bbConnection } from '$lib/server/bluebubbles';

// Photos/files from a thread, streamed through AadOS (the BlueBubbles password never reaches the browser).
export const GET = async ({ params }) => {
  try {
    const res = await attachment(await bbConnection(), params.guid);
    const type = res.headers.get('content-type') || 'application/octet-stream';
    // Only images/audio/video render inline; anything else (e.g. an HTML file someone sent) downloads instead.
    const inline = /^(image|audio|video)\//.test(type) && !/svg/.test(type);
    return new Response(res.body, { headers: { 'content-type': type, 'content-disposition': inline ? 'inline' : 'attachment', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } });
  } catch (e) { throw error(502, e instanceof Error ? e.message : 'Attachment unavailable'); }
};
