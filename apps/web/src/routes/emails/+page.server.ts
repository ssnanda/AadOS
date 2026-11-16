import type { PageServerLoad } from './$types';
import { readState } from '$lib/server/aados-store';

export const load: PageServerLoad = async () => {
  const state = await readState();
  const views = state.pipelines.map((p) => {
    const items = state.items.filter((i) => i.pipelineId === p.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return { id: p.id, name: p.name, parser: p.parser, account: state.accounts.find((a) => a.id === p.accountId)?.email || '', count: items.length, items: items.slice(0, 8).map((i) => ({ id: i.id, subject: i.subject, sender: i.sender, receivedAt: i.receivedAt, kind: i.kind })) };
  });
  return { views };
};
