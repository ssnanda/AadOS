import { json } from '@sveltejs/kit';
import { AiError, describeError } from '$lib/server/ai/ajmcp';
import { generateBriefing } from '$lib/server/ai/briefing-service';
import { rateLimited } from '$lib/server/ai/service';

// Owner-triggered (never on page load): generate and cache today's AI briefing.
export const POST = async ({ request }) => {
  if (rateLimited('briefing', 6)) return json({ error: 'Briefing was refreshed recently; wait a minute.' }, { status: 429 });
  try { return json(await generateBriefing(request.signal)); }
  catch (e) { return json({ error: e instanceof AiError ? describeError(e) : e instanceof Error ? e.message : 'Briefing failed.' }, { status: 400 }); }
};
