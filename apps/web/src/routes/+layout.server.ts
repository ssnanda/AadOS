import type { LayoutServerLoad } from './$types';
import { readState } from '$lib/server/aados-store';

// Sidebar data (views + counts). Nothing is read unless signed in.
export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.authenticated) return { shell: { views: [] } };
  const state = await readState();
  return { shell: { views: state.pipelines.map((p) => ({ id: p.id, name: p.name, parser: p.parser, count: state.items.filter((i) => i.pipelineId === p.id).length })) } };
};
