// Background triage selection. Pure; unit-tested.
export const RECENT_DAYS = 21, PER_PASS = 8, MAX_ATTEMPTS = 3;

/** Which messages need (re)classification: new, content changed, or failed with backoff. Pure; unit-tested. */
export function pickForTriage(rows: { key: string; receivedAt: string; fp: string }[], done: Map<string, { fingerprint: string; status: string; attempts: number; updatedAt: string }>, now = Date.now(), limit = PER_PASS) {
  return rows.filter((r) => {
    if (now - Date.parse(r.receivedAt) > RECENT_DAYS * 86_400_000) return false;
    const prev = done.get(r.key);
    if (!prev || prev.fingerprint !== r.fp) return true;
    if (prev.status === 'failed' && prev.attempts < MAX_ATTEMPTS) return now - Date.parse(prev.updatedAt) > 5 * 60_000 * 2 ** prev.attempts;
    return false;
  }).slice(0, limit);
}

