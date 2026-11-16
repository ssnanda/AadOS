import { error, type PageServerLoad } from '@sveltejs/kit';
import { readState } from '$lib/server/aados-store';

export const load: PageServerLoad = async ({ params }) => {
  const state = await readState();
  const pipeline = state.pipelines.find((item) => item.id === params.id);
  if (!pipeline) throw error(404, 'Pipeline not found');
  return { pipeline, items: state.items.filter((item) => item.pipelineId === pipeline.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 250) };
};
