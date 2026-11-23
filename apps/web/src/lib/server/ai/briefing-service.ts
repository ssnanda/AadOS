import { readState, database, hasDatabase } from '../aados-store';
import { buildRows } from '../inbox';
import { briefingData, briefingPrompt } from './briefing';
import { chat, tzOf } from './service';
import { latestBriefing, saveBriefing } from './db';
import { parseCitations } from './context';

/** Generate (owner-triggered) and cache the AI briefing. Throws AiError when AI is off/unavailable. */
export async function generateBriefing(signal?: AbortSignal) {
  const state = await readState();
  const tz = tzOf(state);
  const data = briefingData({ rows: buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items }), events: state.ai.share.calendar ? state.events : [], disabledCalendars: state.calendarDisabled, tz });
  if (!state.ai.share.email) { data.sources = data.sources.filter((s) => s.kind !== 'email'); for (const k of ['Important email', 'Needs reply', 'Bills', 'Renewals']) delete data.sections[k]; }
  const res = await chat(state, [{ role: 'user', content: briefingPrompt(data, tz) }], signal);
  const { text, cited } = parseCitations(res.reply, data.sources);
  const content = { summary: text, sources: data.sources.filter((s) => cited.includes(s.id)), allSources: data.sources.length, conflicts: data.conflicts, day: data.today };
  await saveBriefing(await database(), content, res.provider, res.model);
  return content;
}
export async function cachedBriefing() { return hasDatabase() ? latestBriefing(await database()).catch(() => null) : null; }
