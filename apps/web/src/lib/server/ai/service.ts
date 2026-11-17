// Server-only glue: AJMCP client from env, owner AI preferences/status, rate limiting, and the assistant pipeline.
import { env } from '$env/dynamic/private';
import { createAjmcpClient, AiError, describeError, type AjmcpClient, type ChatMessage, type ChatResult } from './ajmcp';
import { readState, updateState, database, hasDatabase, type AadOSState } from '../aados-store';
import { buildRows } from '../inbox';
import { buildPrompt, fallbackAnswer, parseCitations, retrieve, type Source } from './context';
import { searchDocumentPassages, tsTerms, addMessage, getConversation, createConversation } from './db';
import { todayIn } from '../../calendar/view';
import { validZone } from '../../calendar/model';

export const aiConfigured = () => Boolean(env.AADOS_AJMCP_URL && env.AADOS_AJMCP_TOKEN);
export const gatewayHost = () => { try { return new URL(env.AADOS_AJMCP_URL || '').host; } catch { return ''; } };

let cached: { key: string; client: AjmcpClient } | null = null;
/** Throws AiError not_configured/disabled; the token never leaves this module. */
export function client(state?: Pick<AadOSState, 'ai'>, opts: { ignoreDisabled?: boolean } = {}): AjmcpClient {
  if (!aiConfigured()) throw new AiError('not_configured', 'missing env');
  if (state && !state.ai.enabled && !opts.ignoreDisabled) throw new AiError('disabled', 'AI disabled');
  const key = `${env.AADOS_AJMCP_URL}|${env.AADOS_AJMCP_TOKEN}|${env.AADOS_AJMCP_TIMEOUT_MS}`;
  if (cached?.key !== key) cached = { key, client: createAjmcpClient({ baseUrl: env.AADOS_AJMCP_URL!, token: env.AADOS_AJMCP_TOKEN!, httpHosts: (env.AADOS_ALLOW_HTTP_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean), timeoutMs: Number(env.AADOS_AJMCP_TIMEOUT_MS) || 60_000, retries: 2, limits: { maxBytes: Number(env.AADOS_AJMCP_MAX_BYTES) || undefined, maxChars: Number(env.AADOS_AJMCP_MAX_CHARS) || undefined, maxMessages: Number(env.AADOS_AJMCP_MAX_MESSAGES) || undefined } }) };
  return cached.client;
}

/** Remember the outcome of the last AI call (shown in Settings → AI). Never stores prompts or replies. */
export async function recordAi(result: { ok: true; provider?: string; model?: string } | { ok: false; error: unknown }) {
  const now = new Date().toISOString();
  await updateState((s) => {
    if (result.ok) s.aiStatus = { ...s.aiStatus, lastOk: now, provider: result.provider || s.aiStatus.provider, model: result.model || s.aiStatus.model };
    else if (!(result.error instanceof AiError && (result.error.kind === 'cancelled' || result.error.kind === 'disabled'))) s.aiStatus = { ...s.aiStatus, lastError: describeError(result.error), lastErrorAt: now };
  }).catch(() => undefined);
}

/** One AI call with status bookkeeping. */
export async function chat(state: Pick<AadOSState, 'ai'>, messages: ChatMessage[], signal?: AbortSignal): Promise<ChatResult> {
  try { const r = await client(state).chat(messages, signal); await recordAi({ ok: true, provider: r.provider, model: r.model }); return r; }
  catch (e) { await recordAi({ ok: false, error: e }); throw e; }
}

// ---- in-memory rate limiting for owner AI/file routes (single replica; bounds accidental loops) ----
const buckets = new Map<string, number[]>();
export function rateLimited(key: string, perMinute: number, now = Date.now()): boolean {
  const recent = (buckets.get(key) || []).filter((t) => now - t < 60_000);
  if (recent.length >= perMinute) { buckets.set(key, recent); return true; }
  recent.push(now); buckets.set(key, recent); return false;
}

export const tzOf = (s: AadOSState) => (validZone(s.prefs.timeZone) ? s.prefs.timeZone : 'UTC');

/** Retrieve AadOS records for a question (respecting sharing settings). Documents are searched in PostgreSQL. */
export async function gather(state: AadOSState, question: string): Promise<ReturnType<typeof retrieve>> {
  const rows = buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items });
  const db = hasDatabase() ? await database().catch(() => null) : null;
  const docHits = db && state.ai.share.documents ? await searchDocumentPassages(db, tsTerms(question.split(/\s+/)).filter((t) => !/^(document|documents|file|files|find|uploaded|about|the|what|which|my)$/.test(t))).catch(() => []) : [];
  return retrieve({
    question, tz: tzOf(state), share: state.ai.share, rows, events: state.events, disabledCalendars: state.calendarDisabled,
    calendarNames: Object.fromEntries(state.calendars.map((c) => [c.id, c.name])), tasks: state.tasks, reminders: state.reminders,
    documents: () => docHits
  });
}

export type AnswerResult = { conversationId: string; user: { id: number }; assistant: { id: number; content: string; sources: Source[]; provider: string; model: string; latencyMs: number | null; error: string } };

/**
 * Assistant turn: retrieve -> bounded prompt -> AJMCP -> keep only real citations -> persist both messages.
 * With AI off/unavailable the answer lists the retrieved records instead (nothing is invented).
 */
export async function answer(question: string, conversationId: string | null, signal?: AbortSignal): Promise<AnswerResult> {
  const q = question.trim().slice(0, 2000);
  if (!q) throw new Error('Ask a question.');
  const db = await database();
  const state = await readState();
  const conv = conversationId ? await getConversation(db, conversationId) : null;
  if (conversationId && !conv) throw new Error('Conversation not found.');
  const id = conv?.conversation.id || (await createConversation(db, q.slice(0, 60))).id;
  const user = await addMessage(db, id, { role: 'user', content: q });
  const { sources, window } = await gather(state, q);
  const tz = tzOf(state);
  let content = '', provider = '', model = '', latencyMs: number | null = null, error = '', usage: Record<string, number> | null = null;
  let kept = sources;
  try {
    if (!state.ai.enabled) throw new AiError('disabled', 'off');
    // Earlier turns give the model conversational context (text only, no earlier sources).
    const history: ChatMessage[] = (conv?.messages || []).filter((m) => !m.error).slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
    const r = await chat(state, [...history, { role: 'user', content: buildPrompt(q, sources, { today: todayIn(tz), tz, window }) }], signal);
    const parsed = parseCitations(r.reply, sources);
    content = parsed.text; provider = r.provider; model = r.model; latencyMs = r.latencyMs; usage = r.usage;
    kept = sources.filter((s) => parsed.cited.includes(s.id));
    if (!kept.length) kept = sources; // model answered without citing: still show what it was given
  } catch (e) {
    if (e instanceof AiError && e.kind === 'cancelled') throw e;
    error = describeError(e);
    content = fallbackAnswer(sources, e instanceof AiError && (e.kind === 'disabled' || e.kind === 'not_configured') ? `${describeError(e)}` : `${describeError(e)}`);
  }
  const saved = await addMessage(db, id, { role: 'assistant', content, sources: kept, provider, model, usage, latencyMs, error });
  return { conversationId: id, user: { id: user.id }, assistant: { id: saved.id, content, sources: kept, provider, model, latencyMs, error } };
}

/**
 * Questions about selected documents (summarize, find a date/amount, compare, locate a clause). Only those documents'
 * most relevant passages are sent; answers cite them. Quotes must come from the passages (never invented).
 */
export async function askDocuments(question: string, ids: string[], signal?: AbortSignal) {
  const state = await readState();
  if (!state.ai.share.documents) throw new AiError('disabled', 'documents not shared');
  const db = await database();
  const terms = tsTerms(question.split(/\s+/)).filter((t) => t.length > 3 && !/^(summari[sz]e|document|documents|compare|these|this|what|which|about|find|clause)$/.test(t));
  let hits = terms.length ? await searchDocumentPassages(db, terms, ids, 6) : [];
  const missing = ids.filter((id) => !hits.some((h) => h.id === id));
  if (missing.length) hits = [...hits, ...await searchDocumentPassages(db, [], missing, missing.length)];
  const sources: Source[] = hits.slice(0, 8).map((h, i) => ({ id: `S${i + 1}`, kind: 'document', ref: h.id, title: h.filename, date: h.date.slice(0, 10), href: `/documents/${h.id}`, excerpt: h.excerpt.replace(/\s+/g, ' ').slice(0, Math.floor(3400 / Math.max(hits.length, 1))), meta: h.category }));
  if (!sources.length) throw new Error('These documents have no extracted text yet.');
  const tz = tzOf(state);
  const r = await chat(state, [{ role: 'user', content: buildPrompt(`${question} (Quote only text that appears in the sources; if a clause or value is not in them, say so.)`, sources, { today: todayIn(tz), tz }) }], signal);
  const { text, cited } = parseCitations(r.reply, sources);
  return { text, sources: sources.filter((s) => cited.includes(s.id)).length ? sources.filter((s) => cited.includes(s.id)) : sources, provider: r.provider, model: r.model };
}
