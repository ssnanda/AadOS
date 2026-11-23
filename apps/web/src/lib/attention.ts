// "Needs your attention" items on the Dashboard: one ranked list across email, Messages, Asana,
// bills and finance. Higher score = sooner. Rough bands: 80+ act now, 60–79 today, 40–59 worth a look.
export type AttentionSource = 'message' | 'email' | 'bill' | 'asana' | 'finance' | 'digest' | 'system';
export type Attention = { id: string; source: AttentionSource; title: string; why: string; href: string; score: number; at?: string; external?: boolean };

export const SOURCE_META: Record<AttentionSource, { icon: string; label: string; color: string }> = {
  message: { icon: '💬', label: 'Message', color: '#139488' },
  email: { icon: '✉', label: 'Email', color: '#3157de' },
  bill: { icon: '＄', label: 'Bill', color: '#c27a12' },
  asana: { icon: '◉', label: 'Asana', color: '#e8566c' },
  finance: { icon: '↗', label: 'Finance', color: '#1e7a47' },
  digest: { icon: '✎', label: 'Review', color: '#2f7d9c' },
  system: { icon: '⚠', label: 'Fix', color: '#a5414d' }
};

/** Merge, drop duplicates (same id, highest score wins) and sort most urgent first; ties go to the newest. */
export function rankAttention(...lists: (Attention[] | null | undefined)[]): Attention[] {
  const by = new Map<string, Attention>();
  for (const list of lists) for (const a of list ?? []) { const prev = by.get(a.id); if (!prev || prev.score < a.score) by.set(a.id, a); }
  return [...by.values()].sort((a, b) => b.score - a.score || (b.at || '').localeCompare(a.at || ''));
}

/** Score for a bill/renewal by how close its due date is (YYYY-MM-DD…); unknown dates rank as "worth a look". */
export function billScore(due: string, today: string): number {
  const m = /^\d{4}-\d{2}-\d{2}/.exec(due || '');
  if (!m) return 45;
  const days = Math.round((Date.parse(`${m[0]}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days < 0 ? 86 : days <= 1 ? 84 : days <= 3 ? 72 : days <= 7 ? 58 : 40;
}

/** Morning / afternoon / evening greeting for the hour in the owner's zone. */
export const greeting = (hour: number) => (hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');

/** Free gaps (≥ minMinutes) between busy blocks inside [from, to] hours; blocks are fractional hours. */
export function freeWindows(busy: { s: number; e: number }[], from: number, to: number, minMinutes = 60): { s: number; e: number }[] {
  const out: { s: number; e: number }[] = [];
  let cur = from;
  for (const b of [...busy].sort((x, y) => x.s - y.s)) {
    if (b.e <= cur) continue;
    if (b.s > cur && (Math.min(b.s, to) - cur) * 60 >= minMinutes) out.push({ s: cur, e: Math.min(b.s, to) });
    cur = Math.max(cur, b.e);
    if (cur >= to) break;
  }
  if ((to - cur) * 60 >= minMinutes) out.push({ s: cur, e: to });
  return out;
}
