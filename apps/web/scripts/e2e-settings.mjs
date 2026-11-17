// Settings edits + owner password change, against the THROWAWAY e2e stack only (port 3199). Restores nothing real.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const B = 'http://127.0.0.1:3199';
const mint = () => { const key = createHmac('sha256', 'e2e1111111111111111111111111111111111111111111111111111111111111111111111111').update('e2e-hash').digest(); const p = Buffer.from(JSON.stringify({ iat: Date.now(), expires: Date.now() + 3600_000 })).toString('base64url'); return `aados_session=${p}.${createHmac('sha256', key).update(p).digest('base64url')}`; };
let failed = 0;
const ok = (c, n, x = '') => { if (!c) failed++; console.log(`${c ? '✓' : '✗'} ${n}${!c && x ? ` | ${x}` : ''}`); };
const sql = (q) => execFileSync('docker', ['exec', '-i', 'aados-e2e-db-1', 'psql', '-U', 'aados', '-d', 'aados', '-At'], { input: q, encoding: 'utf8' }).trim();
const form = async (cookie, path, fields) => { const r = await fetch(B + path, { method: 'POST', headers: { Cookie: cookie, Origin: B, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(fields) }); return { status: r.status, text: await r.text(), setCookie: r.headers.get('set-cookie') || '' }; };
const page = async (cookie, path) => (await fetch(B + path, { headers: { Cookie: cookie }, redirect: 'manual' }));

const c = mint();
// Gateway fields are fixed by the e2e environment -> shown as locked, never revealing the token.
const ai = await (await page(c, '/settings/ai')).text();
ok(ai.includes('Set by environment (AADOS_AJMCP_URL)') && !ai.includes('e2e-ajmcp-token'), 'AI settings: env-locked fields shown, token hidden');
// Storage: validation + encrypted save of keys entered in the UI.
let r = await form(c, '/settings/storage?/save', { endpoint: 'http://insecure.example', bucket: 'aados' });
ok(r.text.includes('HTTPS') || r.text.includes('environment'), 'storage save: env-fixed fields keep env values / http rejected', r.text.slice(0, 160));
r = await form(c, '/settings/ai?/gateway', { url: 'http://evil.example', token: '' });
ok(r.text.includes('https'), 'gateway save: non-HTTPS URL rejected');
r = await form(c, '/settings/ai?/gateway', { url: 'https://ajmcp.example.com', token: 'ui-token-1234567890' });
ok(r.text.includes('saved'), 'gateway save from UI');
const doc = sql(`select data::text from app_state`);
ok(!doc.includes('ui-token-1234567890'), 'UI-entered token is not in the state document');
ok(sql(`select count(*) from mail_credentials where scope='app:integrations'`) === '1', 'UI-entered secrets stored in the encrypted vault');
ok(!(await (await page(c, '/settings/ai')).text()).includes('ui-token-1234567890'), 'token never rendered back');

// Password change. The e2e deployment hash is a placeholder, so install a real hash for a known password as a Settings
// override (in the e2e volume only), exactly as a previous password change would have.
const { hashPassword } = await import('../src/lib/server/password.js');
const { createHash } = await import('node:crypto');
const known = 'old-password-123456', newer = 'a-brand-new-password-42';
const h1 = await hashPassword(known);
const fp = createHash('sha256').update('aados-password-base:e2e-hash').digest('hex');
execFileSync('docker', ['exec', '-i', 'aados-e2e-web-1', 'sh', '-c', 'umask 077; cat > /data/aados/security.json'], { input: JSON.stringify({ validAfter: 0, failures: {}, passwordHash: h1, passwordBase: fp }) });
const cookieFor = (hash) => { const key = createHmac('sha256', 'e2e1111111111111111111111111111111111111111111111111111111111111111111111111').update(hash).digest(); const p = Buffer.from(JSON.stringify({ iat: Date.now(), expires: Date.now() + 3600_000 })).toString('base64url'); return `aados_session=${p}.${createHmac('sha256', key).update(p).digest('base64url')}`; };
const me = cookieFor(h1), otherDevice = cookieFor(h1);
ok((await page(me, '/settings')).status === 200, 'session signed with the current password hash works');
ok((await page(c, '/settings')).status === 303, 'sessions signed with the replaced deployment hash no longer work');
r = await form(me, '/settings?/password', { current: 'wrong', next: newer, confirm: newer });
ok(r.text.includes('Current password is incorrect'), 'password: wrong current password refused');
r = await form(me, '/settings?/password', { current: known, next: 'short', confirm: 'short' });
ok(r.text.includes('12 characters'), 'password: too short refused');
r = await form(me, '/settings?/password', { current: known, next: newer, confirm: newer + 'x' });
ok(r.text.includes('do not match'), 'password: mismatch refused');
r = await form(me, '/settings?/password', { current: known, next: newer, confirm: newer });
ok(r.text.includes('pwSaved'), 'password: changed', r.text.slice(0, 200));
const fresh = (r.setCookie.match(/aados_session=[^;]+/) || [''])[0];
ok(fresh && (await page(fresh, '/settings')).status === 200, 'password: this browser gets a new session and stays signed in');
ok((await page(otherDevice, '/settings')).status === 303, 'password: other devices are signed out');
const stored = JSON.parse(execFileSync('docker', ['exec', 'aados-e2e-web-1', 'cat', '/data/aados/security.json'], { encoding: 'utf8' }));
ok(stored.passwordHash !== h1 && !JSON.stringify(stored).includes(newer), 'password: only a new scrypt hash is stored (never the password)');
const { verifyPassword } = await import('../src/lib/server/password.js');
ok(await verifyPassword(newer, stored.passwordHash), 'password: new password verifies against the stored hash');
const perms = execFileSync('docker', ['exec', 'aados-e2e-web-1', 'stat', '-c', '%a', '/data/aados/security.json'], { encoding: 'utf8' }).trim();
ok(perms === '600', 'security.json is owner-only (0600)', perms);
// Restore the e2e stack's original (placeholder) login so other e2e scripts keep working.
execFileSync('docker', ['exec', '-i', 'aados-e2e-web-1', 'sh', '-c', 'umask 077; cat > /data/aados/security.json'], { input: '{}' });
console.log(failed ? `FAILED: ${failed}` : 'ALL SETTINGS CHECKS PASSED');
process.exit(failed ? 1 : 0);
