import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { deflateRawSync, crc32 } from 'node:zlib';
import { checkUpload, contentDisposition, safeFilename, sniff, MAX_UPLOAD_BYTES } from '../src/lib/server/documents/validate.ts';
import { docxText, extractText, unzipEntry } from '../src/lib/server/documents/extract.ts';
import { createStorage, storageConfigFromEnv, storageError } from '../src/lib/server/documents/storage.ts';

// ---- helpers: a minimal ZIP writer (stored + deflated entries) to build real DOCX files ----
function zip(files: Record<string, string>, deflate = true): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content), data = deflate ? deflateRawSync(raw) : raw, n = Buffer.from(name), crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(deflate ? 8 : 0, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(deflate ? 8 : 0, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data); centrals.push(ch, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const docx = (body: string) => zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': `<w:document><w:body>${body}</w:body></w:document>` });
// A minimal valid PDF with a text layer (xref offsets computed).
function pdf(text: string): Buffer {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

test('validation by content signature, not by name; size limits; unsupported types', () => {
  assert.equal(sniff(pdf('x')), 'application/pdf'); assert.equal(sniff(PNG), 'image/png'); assert.equal(sniff(JPG), 'image/jpeg');
  assert.equal(sniff(docx('<w:p/>')), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(sniff(Buffer.from('plain text ✓')), 'text/plain');
  assert.equal(sniff(zip({ 'other.txt': 'x' })), null); // a ZIP that is not a DOCX
  assert.equal(sniff(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])), null); // EXE header (contains NUL)
  const renamed = checkUpload(PNG, 'invoice.pdf'); // the name lies; content decides
  assert.ok(renamed.ok && renamed.mime === 'image/png' && renamed.filename === 'invoice.pdf.png');
  assert.deepEqual(checkUpload(new Uint8Array(0), 'a.txt'), { ok: false, error: 'The file is empty.' });
  assert.equal((checkUpload(new Uint8Array(MAX_UPLOAD_BYTES + 1), 'big.txt') as { ok: false }).ok, false);
  const ok = checkUpload(Buffer.from('hello'), 'notes.txt');
  assert.ok(ok.ok && ok.checksum === '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' && ok.size === 5);
});

test('filenames are display-only and sanitised (no paths, no header injection)', () => {
  assert.equal(safeFilename('../../etc/passwd', 'text/plain'), 'passwd.txt');
  assert.equal(safeFilename('C:\\Users\\me\\lease 2026.PDF', 'application/pdf'), 'lease 2026.PDF');
  assert.equal(safeFilename('..hidden\u0000<x>.jpeg', 'image/jpeg'), 'hiddenx.jpeg');
  assert.equal(safeFilename('', 'image/png'), 'document.png');
  const cd = contentDisposition('résumé "final".pdf');
  assert.ok(cd.startsWith('attachment; filename="r_sum_ _final_.pdf"')); assert.ok(cd.includes("filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.pdf")); assert.ok(!/[\r\n]/.test(contentDisposition('a\r\nSet-Cookie: x')));
});

test('text extraction: TXT, DOCX (stored and deflated), native PDF; images unsupported; corrupt files fail safely', async () => {
  assert.deepEqual(await extractText(Buffer.from('Rent: $1,950'), 'text/plain'), { status: 'done', text: 'Rent: $1,950', error: '' });
  const d = docx('<w:p><w:r><w:t>Lease term: 12 months</w:t></w:r></w:p><w:p><w:r><w:t>Deposit &amp; fees</w:t></w:r></w:p>');
  assert.equal(docxText(d), 'Lease term: 12 months\nDeposit & fees');
  assert.equal(unzipEntry(zip({ 'word/document.xml': '<w:p>stored</w:p>' }, false), 'word/document.xml')!.toString(), '<w:p>stored</w:p>');
  const p = await extractText(pdf('Hello lease agreement 2026'), 'application/pdf');
  assert.equal(p.status, 'done'); assert.match(p.text, /Hello lease agreement 2026/);
  assert.equal((await extractText(PNG, 'image/png')).status, 'unsupported');
  const bad = await extractText(Buffer.from('PK\u0003\u0004 garbage'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(bad.status, 'failed');
  assert.equal((await extractText(Buffer.from('%PDF-1.4 broken'), 'application/pdf')).status !== 'done', true);
});

test('storage config: HTTPS only (loopback allowed), valid bucket, keys required, secrets never in status', () => {
  const env = { AADOS_S3_ENDPOINT: 'https://rustfs.example.test', AADOS_S3_BUCKET: 'aados-docs', AADOS_S3_ACCESS_KEY: 'AK', AADOS_S3_SECRET_KEY: 'SECRET-KEY' };
  const ok = storageConfigFromEnv(env);
  assert.ok(ok.config); assert.equal(ok.config!.prefix, 'aados/'); assert.equal(ok.config!.forcePathStyle, true);
  assert.ok(!JSON.stringify(ok.status).includes('SECRET'));
  assert.equal(storageConfigFromEnv({}).status.problem, 'Not configured');
  assert.match(storageConfigFromEnv({ ...env, AADOS_S3_ENDPOINT: 'http://rustfs.example.test' }).status.problem, /HTTPS/);
  assert.ok(storageConfigFromEnv({ ...env, AADOS_S3_ENDPOINT: 'http://127.0.0.1:9000' }).config);
  assert.match(storageConfigFromEnv({ ...env, AADOS_S3_BUCKET: 'Bad_Bucket' }).status.problem, /bucket/i);
  assert.match(storageConfigFromEnv({ ...env, AADOS_S3_SECRET_KEY: '' }).status.problem, /SECRET_KEY/);
  assert.equal(storageConfigFromEnv({ ...env, AADOS_S3_PREFIX: '../x y' }).config!.prefix, 'xy/');
});

// ---- a tiny in-process S3 (path-style) to exercise the real AWS SDK client: PUT/GET/HEAD/DELETE + HeadBucket ----
let server: Server; let port = 0; const objects = new Map<string, { body: Buffer; type: string }>(); const seenKeys: string[] = []; let lastAuth = '';
before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c)).on('end', () => {
      lastAuth = String(req.headers.authorization || '');
      if (!lastAuth.includes('Credential=AK/')) { res.writeHead(403, { 'content-type': 'application/xml' }); return res.end('<Error><Code>InvalidAccessKeyId</Code></Error>'); }
      const [, bucket, ...rest] = decodeURIComponent(new URL(req.url!, 'http://x').pathname).split('/');
      const key = rest.join('/');
      if (bucket !== 'aados-docs') { res.writeHead(404, { 'content-type': 'application/xml' }); return res.end('<Error><Code>NoSuchBucket</Code></Error>'); }
      if (!key) { res.writeHead(200); return res.end(); } // HeadBucket
      seenKeys.push(key);
      if (req.method === 'PUT') { objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers['content-type']) }); res.writeHead(200, { etag: '"x"' }); return res.end(); }
      const o = objects.get(key);
      if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
      if (!o) { res.writeHead(404, { 'content-type': 'application/xml' }); return res.end(req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>'); }
      res.writeHead(200, { 'content-type': o.type, 'content-length': o.body.length }); res.end(req.method === 'HEAD' ? undefined : o.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
});
after(() => server?.close());
const cfg = (over: Record<string, string> = {}) => storageConfigFromEnv({ AADOS_S3_ENDPOINT: `http://127.0.0.1:${port}`, AADOS_S3_BUCKET: 'aados-docs', AADOS_S3_ACCESS_KEY: 'AK', AADOS_S3_SECRET_KEY: 'SK', AADOS_S3_TIMEOUT_MS: '3000', ...over }).config!;

test('storage: connection test, upload/download/exists/delete with signed requests and generated keys', async () => {
  const s = createStorage(cfg());
  await s.test();
  const key = s.newKey();
  assert.match(key, /^aados\/documents\/[0-9a-f-]{36}$/);
  await s.put(key, Buffer.from('file body'), 'text/plain', 'abc');
  assert.ok(lastAuth.startsWith('AWS4-HMAC-SHA256')); // SigV4-signed, credentials never in the URL
  assert.equal(await s.exists(key), true);
  const got = await s.get(key);
  assert.equal(Buffer.from(got.body).toString(), 'file body'); assert.equal(got.contentType, 'text/plain');
  await s.remove(key);
  assert.equal(await s.exists(key), false);
  assert.ok(seenKeys.every((k) => k.startsWith('aados/')));
});

test('storage: keys outside the AadOS prefix are refused before any request', async () => {
  const s = createStorage(cfg());
  for (const k of ['other-app/file', 'aados/../secrets', 'aados//x']) await assert.rejects(s.get(k), /outside the AadOS prefix/);
});

test('storage errors are friendly and secret-free: wrong key, wrong bucket, unreachable', async () => {
  const wrongKey = createStorage(cfg({ AADOS_S3_ACCESS_KEY: 'NOPE' }));
  await assert.rejects(wrongKey.test(), (e) => /Access denied|RustFS error/.test(storageError(e)) && !storageError(e).includes('NOPE'));
  await assert.rejects(createStorage(cfg({ AADOS_S3_BUCKET: 'missing-bucket' })).test(), (e) => storageError(e) === 'Bucket or object not found');
  await assert.rejects(createStorage(cfg({ AADOS_S3_ENDPOINT: 'http://127.0.0.1:1' })).test(), (e) => /reach|failed|time/.test(storageError(e)));
});

test('storage: plain HTTP only for loopback or AADOS_ALLOW_HTTP_HOSTS', () => {
  const env = { AADOS_S3_ENDPOINT: 'http://mock:9998', AADOS_S3_BUCKET: 'aados-docs', AADOS_S3_ACCESS_KEY: 'AK', AADOS_S3_SECRET_KEY: 'SK' };
  assert.equal(storageConfigFromEnv(env).config, null);
  assert.ok(storageConfigFromEnv({ ...env, AADOS_ALLOW_HTTP_HOSTS: 'mock' }).config);
});
