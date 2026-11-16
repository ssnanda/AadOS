import type { PageServerLoad } from './$types';
import { readState } from '$lib/server/aados-store';
import { isUnread } from '$lib/server/search';

export const load: PageServerLoad = async () => {
  const state = await readState();
  const tiles = state.pipelines.map((p) => {
    const items = state.items.filter((i) => i.pipelineId === p.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const unread = items.filter(isUnread);
    const account = state.accounts.find((a) => a.id === p.accountId);
    return {
      id: p.id, name: p.name, parser: p.parser, source: p.source, enabled: p.enabled, lastSync: p.lastSync, lastError: p.lastError,
      account: account?.email || '', count: unread.length,
      kinds: Object.entries(items.reduce<Record<string, number>>((m, i) => ({ ...m, [i.kind]: (m[i.kind] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 4),
      latest: items.slice(0, 3).map((i) => ({ id: i.id, subject: i.subject, sender: i.sender, receivedAt: i.receivedAt }))
    };
  });
  return { tiles, accounts: state.accounts.length, unread: state.items.filter(isUnread).length };
};
