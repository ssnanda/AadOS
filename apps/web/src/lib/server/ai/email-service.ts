// On-demand email AI (summaries, explanations, follow-ups, drafts), the background triage worker, and saving
// selected attachments as documents. Provider mailboxes are only READ; nothing is ever sent or modified.
import { readState, updateState, updateStateDetached, database, hasDatabase, type AadOSState } from '../aados-store';
import { buildRows, type InboxRow } from '../inbox';
import { fetchGmailBody, fetchGmailAttachment, listGmailAttachments } from '../gmail';
import { fetchZohoBody, fetchZohoAttachment, listZohoAttachments } from '../zoho';
import { AiError, describeError } from './ajmcp';
import { aiConfigured, chat, tzOf } from './service';
import { askPrompt, cleanDraft, draftPrompt, fingerprint, htmlToText, insightPrompt, parseInsight, type Ask, type EmailInput, type Tone } from './email-ai';
import { getInsights, insightStats, saveDraft, saveInsight } from './db';
import { todayIn } from '../../calendar/view';
import { saveDocument } from '../documents/service';
import { pickForTriage } from './triage';
export { pickForTriage };

export function findRow(state: AadOSState, key: string): InboxRow | null {
  return buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items }).find((r) => r.key === key) || null;
}
const input = (r: InboxRow, body = ''): EmailInput => ({ subject: r.subject, sender: r.sender, receivedAt: r.receivedAt, summary: r.summary, body, account: r.accountEmail });

/** Full text of one message (read-only provider call). Token refreshes are persisted; failures fall back to the snippet. */
async function body(r: InboxRow): Promise<string> {
  let text = '';
  await updateStateDetached(async (s) => {
    const item = s.items.find((i) => i.id === r.id);
    const pipeline = s.pipelines.find((p) => p.id === r.pipelineId);
    const account = s.accounts.find((a) => a.id === r.accountId);
    if (!item || !pipeline || !account) return;
    const b = account.provider === 'gmail' ? await fetchGmailBody(s, account, item) : await fetchZohoBody(s, account, pipeline, item);
    text = b.text || htmlToText(b.html);
  }).catch(() => undefined);
  return text;
}

/** Summarize / explain importance / suggest follow-up. Sends the full body only if Settings → AI allows it. */
export async function ask(kind: Ask, key: string, signal?: AbortSignal) {
  const state = await readState();
  const r = findRow(state, key);
  if (!r) throw new Error('Email not found.');
  if (!state.ai.share.email) throw new AiError('disabled', 'email sharing off');
  const text = state.ai.emailBodies ? await body(r) : '';
  const res = await chat(state, [{ role: 'user', content: askPrompt(kind, input(r, text), todayIn(tzOf(state))) }], signal);
  return { text: res.reply, provider: res.provider, model: res.model, usedBody: Boolean(text) };
}

/** Classify one message now (also used by the background worker). */
export async function classify(key: string, state?: AadOSState, signal?: AbortSignal) {
  const s = state || await readState();
  const r = findRow(s, key);
  if (!r) throw new Error('Email not found.');
  const db = await database();
  const fp = fingerprint(r);
  try {
    const res = await chat(s, [{ role: 'user', content: insightPrompt(input(r), todayIn(tzOf(s))) }], signal);
    const insight = parseInsight(res.reply);
    if (!insight) { await saveInsight(db, key, fp, { error: 'AI reply was not valid JSON' }); throw new AiError('invalid_response', 'insight'); }
    await saveInsight(db, key, fp, { insight, provider: res.provider, model: res.model });
    return insight;
  } catch (e) {
    if (e instanceof AiError && !['invalid_response', 'cancelled', 'disabled', 'not_configured'].includes(e.kind)) await saveInsight(db, key, fp, { error: describeError(e) });
    throw e;
  }
}

export async function draft(key: string, tone: Tone, current = '', draftId?: number, signal?: AbortSignal) {
  const state = await readState();
  const r = findRow(state, key);
  if (!r) throw new Error('Email not found.');
  if (!state.ai.share.email) throw new AiError('disabled', 'email sharing off');
  const text = state.ai.emailBodies ? await body(r) : '';
  const res = await chat(state, [{ role: 'user', content: draftPrompt(tone, input(r, text), current) }], signal);
  const content = cleanDraft(res.reply);
  const saved = await saveDraft(await database(), { id: tone === 'reply' || tone === 'regenerate' ? undefined : draftId, key, content, tone, aiGenerated: true, edited: false });
  return { draft: saved, provider: res.provider, model: res.model };
}

// ---- attachments (selective import into Documents) ----
export async function attachments(key: string) {
  const state = await readState();
  const r = findRow(state, key);
  if (!r) throw new Error('Email not found.');
  let list: { id: string; name: string; size: number; mime: string }[] = [];
  await updateStateDetached(async (s) => {
    const account = s.accounts.find((a) => a.id === r.accountId);
    const item = s.items.find((i) => i.id === r.id);
    if (!account || !item) throw new Error('Account not connected.');
    list = account.provider === 'gmail' ? await listGmailAttachments(s, account, item.messageId) : await listZohoAttachments(s, account, item.folderId || '', item.messageId);
  });
  return list;
}
export async function saveAttachment(key: string, attachmentId: string, filename: string) {
  const state = await readState();
  const r = findRow(state, key);
  if (!r) throw new Error('Email not found.');
  let bytes: Uint8Array = new Uint8Array();
  await updateStateDetached(async (s) => {
    const account = s.accounts.find((a) => a.id === r.accountId);
    const item = s.items.find((i) => i.id === r.id);
    if (!account || !item) throw new Error('Account not connected.');
    bytes = account.provider === 'gmail' ? await fetchGmailAttachment(s, account, item.messageId, attachmentId) : await fetchZohoAttachment(s, account, item.folderId || '', item.messageId, attachmentId);
  });
  // Same attachment twice -> same source ref -> the existing document is returned (no duplicate import).
  return saveDocument(bytes, filename, { sourceType: 'email', sourceRef: `${r.key}#${attachmentId}`.slice(0, 250), category: 'Email attachment' });
}

// ---- background triage (only when the owner enabled AI AND background processing) ----
const RECENT_DAYS = 21, CONCURRENCY = 2;
declare global { var __aadosTriageTimer: ReturnType<typeof setInterval> | undefined; var __aadosTriageBusy: boolean | undefined; var __aadosTriage: { last: string; processed: number; failed: number; note: string } | undefined; }
export const triageStatus = () => globalThis.__aadosTriage || { last: '', processed: 0, failed: 0, note: '' };

export async function triagePass(): Promise<{ processed: number; failed: number; note: string }> {
  const state = await readState();
  if (!state.ai.enabled || !state.ai.background || !state.ai.share.email) return { processed: 0, failed: 0, note: 'Background AI triage is off.' };
  if (!aiConfigured(state)) return { processed: 0, failed: 0, note: 'AJMCP gateway not configured.' };
  // Insights live in PostgreSQL (ai_insights); file-storage deployments can't run triage.
  if (!hasDatabase()) return { processed: 0, failed: 0, note: 'Triage needs PostgreSQL storage (AADOS_STORAGE=postgres + AADOS_DATABASE_URL); this server uses file storage.' };
  const db = await database();
  const rows = buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items }).map((r) => ({ key: r.key, receivedAt: r.receivedAt, fp: fingerprint(r) }));
  const done = await getInsights(db, rows.filter((r) => Date.now() - Date.parse(r.receivedAt) <= RECENT_DAYS * 86_400_000).map((r) => r.key));
  const queue = pickForTriage(rows, done);
  let processed = 0, failed = 0, stop = '';
  const worker = async () => {
    while (queue.length && !stop) {
      const next = queue.shift()!;
      try { await classify(next.key, state); processed++; }
      catch (e) { failed++; if (e instanceof AiError && ['auth', 'forbidden', 'rate_limit', 'not_configured', 'disabled'].includes(e.kind)) stop = describeError(e); }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const note = stop || (queue.length ? 'More messages queued for the next pass.' : 'Up to date.');
  globalThis.__aadosTriage = { last: new Date().toISOString(), processed, failed, note };
  return { processed, failed, note };
}

export function startTriageWorker() {
  if (globalThis.__aadosTriageTimer) return;
  globalThis.__aadosTriageTimer = setInterval(async () => {
    if (globalThis.__aadosTriageBusy) return;
    globalThis.__aadosTriageBusy = true;
    try { await triagePass(); } catch (e) { console.warn('[aados] AI triage pass failed:', e instanceof Error ? e.message : e); }
    finally { globalThis.__aadosTriageBusy = false; }
  }, 180_000);
  globalThis.__aadosTriageTimer.unref?.();
}

export async function triageSummary() { return hasDatabase() ? insightStats(await database()).catch(() => null) : null; }

/** Apply an AI suggestion the owner accepted (local only): category override and/or reviewed state. */
export async function applySuggestion(key: string, op: 'category' | 'reviewed', category = '') {
  await updateState((s) => {
    const owner = (i: { pipelineId: string; accountId?: string }) => i.accountId || s.pipelines.find((p) => p.id === i.pipelineId)?.accountId || '';
    for (const item of s.items.filter((i) => `${owner(i)}:${i.messageId}` === key)) {
      if (op === 'category' && category) item.categories = [category];
      if (op === 'reviewed') item.actionState = 'reviewed';
    }
  });
}
