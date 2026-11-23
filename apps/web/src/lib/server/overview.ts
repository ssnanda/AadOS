// Dashboard daily overview of the inbox (important, needs reply, bills/renewals, upcoming deadlines, sync errors).
// Pure (type-only imports) so it is unit-tested with `node --test`. Tasks live in Asana; there is no local task list.
import type { InboxRow } from './inbox.ts';

export const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export type Overview = {
  important: InboxRow[]; needsReply: InboxRow[]; billsRenewals: InboxRow[]; upcoming: InboxRow[];
  counts: { important: number; needsReply: number; billsRenewals: number; upcoming: number };
  errors: { id: string; label: string; message: string }[];
};

/** Daily overview from real data only; every list is empty when there is nothing to show. */
export function overview(input: { rows: InboxRow[]; accounts: { id: string; provider: string; email: string; lastError?: string }[]; today: string }, limit = 5): Overview {
  const { rows, today } = input;
  const important = rows.filter((r) => r.importance === 'high' && r.unread);
  const needsReply = rows.filter((r) => r.action === 'reply' && !r.reviewed);
  const bills = rows.filter((r) => (r.categories.includes('Bills') || r.categories.includes('Renewals')) && r.unread);
  const horizon = addDays(today, 14);
  const upcoming = rows.filter((r) => r.due && r.due >= today && r.due <= horizon && !r.reviewed).sort((a, b) => a.due.localeCompare(b.due));
  return {
    important: important.slice(0, limit), needsReply: needsReply.slice(0, limit), billsRenewals: bills.slice(0, limit), upcoming: upcoming.slice(0, limit),
    counts: { important: important.length, needsReply: needsReply.length, billsRenewals: bills.length, upcoming: upcoming.length },
    errors: input.accounts.filter((a) => a.lastError).map((a) => ({ id: a.id, label: `${a.provider === 'gmail' ? 'Gmail' : 'Zoho'} · ${a.email}`, message: a.lastError! }))
  };
}
