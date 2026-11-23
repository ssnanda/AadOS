import { error, json } from '@sveltejs/kit';
import { keyAllowed } from '$lib/server/scope';
import { attachmentBytes, attachments } from '$lib/server/ai/email-service';
import { contentDisposition, sniff } from '$lib/server/documents/validate';

// Email attachments for the viewer, streamed through AadOS (provider tokens never reach the browser). Read-only.
//   GET ?key=…            -> { attachments: [{ id, name, size, mime }] }
//   GET ?key=…&id=…&name=…[&dl=1] -> the file (inline preview or download)
// Only content sniffed as PDF/PNG/JPEG (magic bytes, not the sender's filename or type) is served inline; everything
// else is forced to download so an attached HTML/SVG can never run on the AadOS origin.
export const GET = async ({ url, locals }) => {
  const key = (url.searchParams.get('key') || '').slice(0, 300);
  if (!key || !keyAllowed(locals.user, key)) throw error(404, 'Email not found.');
  const id = (url.searchParams.get('id') || '').slice(0, 2000);
  try {
    if (!id) return json({ attachments: await attachments(key) }, { headers: { 'cache-control': 'private, no-store' } });
    const bytes = await attachmentBytes(key, id);
    const name = (url.searchParams.get('name') || 'attachment').replace(/[\\/\x00-\x1f]/g, '_').slice(0, 200) || 'attachment';
    const kind = sniff(bytes);
    const inline = url.searchParams.get('dl') !== '1' && (kind === 'application/pdf' || kind === 'image/png' || kind === 'image/jpeg');
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        'content-type': inline && kind ? kind : 'application/octet-stream',
        'content-disposition': contentDisposition(name, inline),
        'content-length': String(bytes.byteLength),
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        // Chrome's PDF viewer refuses to render under a CSP sandbox, so PDFs skip it; images/downloads keep it.
        ...(inline && kind === 'application/pdf' ? {} : { 'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:" })
      }
    });
  } catch (e) { throw error(502, e instanceof Error ? e.message : 'Attachment unavailable.'); }
};
