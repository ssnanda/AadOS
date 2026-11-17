// Local test doubles for the throwaway e2e stack (compose project aados-e2e only). NOT production services.
//  :9999  mock AJMCP  — /v1/capabilities, /v1/chat (bearer "e2e-ajmcp-token"); answers are deterministic and cite [S1].
//  :9998  fake S3     — path-style PUT/GET/HEAD/DELETE + HeadBucket for bucket "aados-e2e" (requires SigV4 with key "e2eak").
import { createServer } from 'node:http';

const TOKEN = 'e2e-ajmcp-token';
const log = []; // last prompts, so the e2e check can verify what was (and was not) sent
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c)).on('end', () => {
    if (req.url === '/__log') return send(res, 200, log.slice(-50));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' && req.url === '/v1/capabilities') return send(res, 200, { version: 'mock-1', id: 'aados-e2e', kind: 'site', provider: 'mockai', endpoints: ['/v1/chat', '/v1/ajcore/reply', '/v1/assistant', '/mcp'] });
    if (req.method === 'POST' && req.url === '/v1/chat') {
      const raw = Buffer.concat(chunks);
      if (raw.length > 32 * 1024) return send(res, 413, { error: 'request_too_large' });
      const body = JSON.parse(raw.toString() || '{}');
      const last = body.messages?.at(-1)?.content || '';
      log.push({ bytes: raw.length, messages: body.messages?.length, keys: Object.keys(body), last });
      let reply;
      if (last.includes('Reply with ONLY one JSON object')) reply = JSON.stringify({ summary: 'Mock: electricity bill of $82.10 due 2026-11-30', category: 'Bills', importance: 'high', needsReply: false, deadline: '2026-11-30', paymentDue: '2026-11-30', amount: '$82.10', renewalDate: null, appointment: null, suggestedTask: 'Pay electricity bill', nextAction: 'Pay before the due date', confidence: 0.92, reason: 'The email states the amount and due date' });
      else if (last.includes('daily briefing')) reply = 'Mock briefing: you have a dentist visit [S1].\nNext actions:\n- Prepare for it [S1]';
      else if (last.includes('draft email replies')) reply = 'Subject: Re: test\n\nHi,\n\nThanks for your note. [placeholder]\n\nBest';
      else if (last.includes('SOURCES')) reply = 'Mock answer based on your data [S1]. Unknown ref [S99] should be removed.';
      else reply = 'Mock summary of the email.';
      return send(res, 200, { requestId: `r${log.length}`, site: 'aados-e2e', reply, provider: 'mockai', model: 'mock-model-1', usage: { input_tokens: 12, output_tokens: 7 } });
    }
    send(res, 404, { error: 'not_found' });
  });
}).listen(9999, '0.0.0.0');

const objects = new Map();
createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c)).on('end', () => {
    if (!String(req.headers.authorization || '').includes('Credential=e2eak/')) { res.writeHead(403); return res.end('<Error><Code>InvalidAccessKeyId</Code></Error>'); }
    const [, bucket, ...rest] = decodeURIComponent(new URL(req.url, 'http://x').pathname).split('/');
    const key = rest.join('/');
    if (bucket !== 'aados-e2e') { res.writeHead(404); return res.end('<Error><Code>NoSuchBucket</Code></Error>'); }
    if (!key) { res.writeHead(200); return res.end(); }
    if (req.method === 'PUT') { objects.set(key, { body: Buffer.concat(chunks), type: req.headers['content-type'] }); res.writeHead(200, { etag: '"e"' }); return res.end(); }
    if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
    const o = objects.get(key);
    if (!o) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': o.type, 'content-length': o.body.length }); res.end(req.method === 'HEAD' ? undefined : o.body);
  });
}).listen(9998, '0.0.0.0');
console.log('e2e mocks listening on 9999 (AJMCP) and 9998 (S3)');
