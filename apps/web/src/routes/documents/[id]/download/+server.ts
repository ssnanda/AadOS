import { error } from '@sveltejs/kit';
import { readDocument } from '$lib/server/documents/service';
import { contentDisposition } from '$lib/server/documents/validate';

// Authenticated proxy download (the bucket is never public; no presigned URLs are handed out).
// Images and PDFs may be shown inline with ?inline=1; everything is served with nosniff and a sandboxing CSP.
export const GET = async ({ params, url }) => {
  if (!/^[0-9a-f-]{36}$/.test(params.id)) throw error(404, 'Not found');
  let found;
  try { found = await readDocument(params.id); } catch (e) { throw error(502, e instanceof Error ? e.message : 'Storage error'); }
  if (!found) throw error(404, 'Not found');
  const inline = url.searchParams.get('inline') === '1' && /^(image\/(png|jpeg)|application\/pdf)$/.test(found.doc.mime);
  return new Response(found.body as unknown as BodyInit, { headers: {
    'content-type': found.doc.mime, 'content-length': String(found.body.byteLength), 'content-disposition': contentDisposition(found.doc.filename, inline),
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", 'cache-control': 'private, no-store'
  } });
};
