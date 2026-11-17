import { json } from '@sveltejs/kit';
import { saveDocument } from '$lib/server/documents/service';
import { MAX_UPLOAD_BYTES } from '$lib/server/documents/validate';
import { rateLimited } from '$lib/server/ai/service';

// Owner-only (session enforced in hooks). Raw body upload so the browser can show progress (XHR upload events).
// The filename is display metadata only; the object key is generated server-side.
export const POST = async ({ request, url }) => {
  if (rateLimited('upload', 30)) return json({ error: 'Too many uploads; wait a minute.' }, { status: 429 });
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_UPLOAD_BYTES) return json({ error: `Files can be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'Empty upload (send the file with a Content-Type header).' }, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPLOAD_BYTES) { await reader.cancel(); return json({ error: `Files can be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }, { status: 413 }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let o = 0; for (const c of chunks) { bytes.set(c, o); o += c.byteLength; }
  try {
    const r = await saveDocument(bytes, url.searchParams.get('name') || 'document', { folder: url.searchParams.get('folder') || '', category: url.searchParams.get('category') || '' });
    return json({ id: r.doc.id, filename: r.doc.filename, duplicate: r.duplicate });
  } catch (e) { return json({ error: e instanceof Error ? e.message : 'Upload failed.' }, { status: 400 }); }
};
