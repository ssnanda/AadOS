import type { PageServerLoad } from './$types';
import { pipelineFolders, readState, visiblePipelines } from '$lib/server/aados-store';
import { isUnread } from '$lib/server/search';
import { buildRows, queryInbox } from '$lib/server/inbox';

export const load: PageServerLoad = async () => {
  const state = await readState();
  const tiles = visiblePipelines(state).map((p) => {
    const items = state.items.filter((i) => i.pipelineId === p.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const unread = items.filter(isUnread);
    return {
      id: p.id, name: p.name, parser: p.parser, source: p.source, enabled: p.enabled, lastSync: p.lastSync, lastError: p.lastError,
      account: [...new Set(pipelineFolders(p).map((f) => state.accounts.find((a) => a.id === f.accountId)?.email).filter(Boolean))].join(', '), count: unread.length,
      kinds: Object.entries(items.reduce<Record<string, number>>((m, i) => ({ ...m, [i.kind]: (m[i.kind] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 4),
      latest: items.slice(0, 3).map((i) => ({ id: i.id, subject: i.subject, sender: i.sender, receivedAt: i.receivedAt }))
    };
  });
  // Deduplicated across accounts and views; the page size of 1 keeps this cheap (only counts are used).
  const { counts } = queryInbox(buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items }), { view: 'all', pageSize: 1 });
  const inbox = { unread: counts.unread, needsReply: counts.needsReply, important: counts.important, bills: counts.categories['Bills'] || 0, renewals: counts.categories['Renewals'] || 0, receipts: counts.categories['Receipts'] || 0 };
  return { tiles, accounts: state.accounts.length, unread: counts.unread, inbox };
};
