import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// E*TRADE OAuth 1.0a signing and Plaid holding mapping are re-declared minimal here (the modules import SvelteKit env);
// the logic mirrors src/lib/server/finance/etrade.ts and plaid.ts exactly.
const enc = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
function signature(method: string, url: URL, key: string, secret: string, token: { token: string; secret: string } | null, extra: Record<string, string>, nonce: string, ts: string) {
  const params: Record<string, string> = { oauth_consumer_key: key, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: ts, ...(token ? { oauth_token: token.token } : {}), ...extra };
  const pairs = [...url.searchParams.entries(), ...Object.entries(params)].map(([k, v]) => [enc(k), enc(v)] as const).sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const base = [method, enc(`${url.origin}${url.pathname}`), enc(pairs.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  return createHmac('sha1', `${enc(secret)}&${enc(token?.secret ?? '')}`).update(base).digest('base64');
}

test('OAuth 1.0a signature matches the RFC 5849 reference example', () => {
  // RFC 5849 §3.4.1 example (photos.example.net): known-good signature tR3+Ty81lMeYAr/Fid0kMTYa/WM=
  const url = new URL('http://photos.example.net/photos?file=vacation.jpg&size=original');
  const sig = signature('GET', url, 'dpf43f3p2l4k3l03', 'kd94hf93k423kf44', { token: 'nnch734d00sl2jdk', secret: 'pfkkdhi9sl3r4s00' }, {}, 'kllo9940pd9333jh', '1191242096');
  assert.equal(sig, 'tR3+Ty81lMeYAr/Fid0kMTYa/WM=');
});
