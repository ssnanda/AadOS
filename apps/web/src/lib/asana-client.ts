// Browser helper for /asana/api. Throws with Asana's (or AadOS's) readable message on failure.
export async function asanaApi<T = any>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('/asana/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, ...payload }) }).catch(() => null);
  if (!res) throw new Error('Could not reach AadOS.');
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
  return body as T;
}
