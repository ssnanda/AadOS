// Browser helper for the /emails `mark` action (delete to Trash, mark read/unread, local review ops).
// SvelteKit actions answer {type, data}; data is devalue-encoded, so the readable message is pulled out of it.
export async function mailAction(op: string, keys: string[], value = ''): Promise<{ ok: boolean; message: string }> {
  const body = new FormData();
  for (const key of keys) body.append('keys', key);
  body.set('op', op);
  if (value) body.set('value', value);
  const res = await fetch('/emails?/mark', { method: 'POST', body, headers: { accept: 'application/json' } }).catch(() => null);
  if (!res) return { ok: false, message: 'Could not reach AadOS.' };
  const out = await res.json().catch(() => ({}));
  const message = (() => { try { const d = JSON.parse(out.data || '[]'); const o = d[0] || {}; const pick = (k: string) => (k in o ? d[o[k]] : ''); return String(pick('error') || pick('warning') || ''); } catch { return ''; } })();
  return { ok: out.type === 'success', message };
}
