#!/usr/bin/env node
// Safe, read-only tooling for the encrypted AadOS state file (never modifies state.enc).
//   node scripts/state-tool.mjs backup            copy state.enc to a timestamped 0600 backup and verify it decrypts
//   node scripts/state-tool.mjs verify            decrypt and print record counts only (no contents)
//   node scripts/state-tool.mjs export <out.json> write accounts/views/messages WITHOUT tokens or OAuth secrets (0600)
// Env: AADOS_SESSION_SECRET (>= 64 chars, same as the app), AADOS_DATA_DIR (default ./.data, /data/aados in prod).
import { createDecipheriv, createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.AADOS_DATA_DIR || (process.env.NODE_ENV === 'production' ? '/data/aados' : join(process.cwd(), '.data'));
const file = join(dir, 'state.enc');
const fail = (message) => { console.error(`ERROR: ${message}`); process.exit(1); };

function load() {
  const secret = process.env.AADOS_SESSION_SECRET || '';
  if (secret.length < 64) fail('AADOS_SESSION_SECRET must contain at least 64 characters');
  if (!existsSync(file)) fail(`no state file at ${file}`);
  const [version, iv, tag, ciphertext] = readFileSync(file, 'utf8').trim().split('.');
  if (version !== 'v1') fail('unsupported state format');
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(`aados-state-v1:${secret}`).digest(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  try { return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')); }
  catch { fail('could not decrypt (wrong AADOS_SESSION_SECRET or corrupt file)'); }
}

const counts = (s) => ({ accounts: (s.accounts || []).length, views: (s.pipelines || []).filter((p) => !p.system).length, inboxFeeds: (s.pipelines || []).filter((p) => p.system).length, messages: (s.items || []).length, dismissed: (s.dismissed || []).length });

export function redact(state) {
  const owner = (item) => item.accountId || (state.pipelines || []).find((p) => p.id === item.pipelineId)?.accountId || '';
  return {
    version: 1,
    accounts: (state.accounts || []).map(({ id, provider, email, remoteId, folders, lastSync, lastError, paused }) => ({ id, provider, email, remoteId, folders, lastSync, lastError, paused })),
    pipelines: (state.pipelines || []).map(({ id, name, accountId, parser, enabled, system, folders }) => ({ id, name, accountId, parser, enabled, system: Boolean(system), folders })),
    items: (state.items || []).map((item) => ({ ...item, accountId: owner(item) })),
    dismissed: state.dismissed || []
  };
}

const [command, target] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (command === 'backup') {
    const state = load();
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(file, backup); chmodSync(backup, 0o600);
    console.log(`backup: ${backup}\n${JSON.stringify(counts(state))}`);
  } else if (command === 'verify') {
    console.log(JSON.stringify(counts(load())));
  } else if (command === 'export' && target) {
    if (existsSync(target)) fail(`${target} already exists; refusing to overwrite`);
    const out = redact(load());
    writeFileSync(target, JSON.stringify(out), { mode: 0o600 });
    console.log(`exported ${target}\n${JSON.stringify({ accounts: out.accounts.length, messages: out.items.length })}`);
  } else fail('usage: state-tool.mjs backup | verify | export <out.json>');
}
