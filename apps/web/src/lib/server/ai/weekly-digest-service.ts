// Runs the weekly review for "Weekly review" views (parser 'digest'): sync the view, read each new email (body +
// PDF/DOCX/text attachments) with the AI, cache the result per email, and feed open items to the Dashboard.
// Mailboxes are only READ here; nothing is sent, moved or marked.
import { readState, updateState, updateStateDetached, type AadOSState, type Pipeline, type PipelineItem } from '../aados-store';
import { fetchGmailAttachment, fetchGmailBody, listGmailAttachments, syncGmailPipeline } from '../gmail';
import { fetchZohoAttachment, fetchZohoBody, listZohoAttachments, syncPipeline as syncZohoPipeline } from '../zoho';
import { extractText } from '../documents/extract';
import { sniff } from '../documents/validate';
import { htmlToText } from './email-ai';
import { AiError, describeError } from './ajmcp';
import { aiConfigured, chat, tzOf } from './service';
import { todayIn } from '../../calendar/view';
import * as asana from '../asana';
import { duePayload } from '../../asana-model';
import type { Attention } from '../../attention';
import {
  DEFAULT_FOCUS, DIGEST_DAYS, KEEP_DAYS, MAX_ATTEMPTS, buildDigest, chunkText, combineParts, digestScore, emptyDigest, needsReview, parseReview,
  reviewFingerprint, reviewPrompt, type DigestEmail, type DigestState, type EmailReview
} from './weekly-digest';
import { SESSION_KEEP_DAYS, emptySessions, narrativePrompt, parseSession, sessionFingerprint, sessionPrompt, sessionSourceOf, sessionTrends, trendBasis, type Session } from './session-tracker';

const CONCURRENCY = 2;
/** AJMCP allows 30 requests/minute per identity; stay under it (shared with other AadOS AI use). */
const MIN_GAP_MS = 2300;
let nextSlot = 0;
async function ask(state: AadOSState, content: string) {
  const now = Date.now(), at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
  return chat(state, [{ role: 'user', content }]);
}
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Non-PDF coverage stays bounded; every PDF attached to an AAD review email is inspected. */
const MAX_OTHER_ATTACHMENTS = 4;
const MAX_PDF_CHUNKS = 20;
/** Background runs: at most once per this interval per view (only new mail is read, so this is cheap). */
const AUTO_EVERY_MS = 12 * 3_600_000;

type Progress = { running: boolean; done: number; total: number; note: string };
declare global { var __aadosDigest: Map<string, Progress> | undefined; }
const progressMap = () => (globalThis.__aadosDigest ??= new Map());
export const digestProgress = (id: string): Progress => progressMap().get(id) || { running: false, done: 0, total: 0, note: '' };

export const focusOf = (p: Pipeline) => (p.focus || '').trim() || DEFAULT_FOCUS;
const childOf = (p: Pipeline) => p.name.replace(/\b(summary|review|weekly|school|mail)\b/gi, '').trim() || 'your child';
const ownerOf = (s: AadOSState, i: PipelineItem) => i.accountId || s.pipelines.find((p) => p.id === i.pipelineId)?.accountId || '';
const keyOf = (s: AadOSState, i: PipelineItem) => `${ownerOf(s, i)}:${i.messageId}`;

type Email = DigestEmail & { item: PipelineItem; session: boolean };
/** This view's emails, one per source message, newest kept window. */
function emailsOf(state: AadOSState, pipeline: Pipeline, now = Date.now()): Email[] {
  const seen = new Set<string>(), out: Email[] = [];
  for (const item of state.items.filter((i) => i.pipelineId === pipeline.id)) {
    const key = keyOf(state, item);
    const session = Boolean(sessionSourceOf(item));
    const age = (now - Date.parse(item.receivedAt)) / 86_400_000;
    if (seen.has(key) || age > (session ? SESSION_KEEP_DAYS : KEEP_DAYS)) continue;
    seen.add(key);
    out.push({ key, subject: item.subject || '(no subject)', sender: item.sender, receivedAt: item.receivedAt, href: `/emails?view=all&q=${encodeURIComponent((item.subject || '').slice(0, 60))}`, item, session });
  }
  return out;
}

type ReadSource = { label: string; text: string; maxChunks?: number };
/** Body + readable attachment text of one email (read-only provider calls on a detached snapshot). Every PDF is read. */
async function readEmail(s: AadOSState, pipeline: Pipeline, item: PipelineItem): Promise<{ text: string; sources: ReadSource[]; attachments: string[] }> {
  const account = s.accounts.find((a) => a.id === ownerOf(s, item));
  if (!account) throw new Error('Account not connected.');
  const own = s.items.find((i) => i.id === item.id) || item;
  const b = account.provider === 'gmail' ? await fetchGmailBody(s, account, own) : await fetchZohoBody(s, account, pipeline, own);
  const body = (b.text || htmlToText(b.html) || own.summary || '').trim();
  const sources: ReadSource[] = [{ label: 'Email body', text: body }];
  const names: string[] = [];
  const list = await (account.provider === 'gmail' ? listGmailAttachments(s, account, own.messageId) : listZohoAttachments(s, account, own.folderId || '', own.messageId)).catch(() => []);
  const pdfs = list.filter((a) => a.mime.toLowerCase() === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf'));
  const others = list.filter((a) => !pdfs.includes(a)).slice(0, MAX_OTHER_ATTACHMENTS);
  for (const a of [...pdfs, ...others]) {
    if (a.size > MAX_ATTACHMENT_BYTES) { names.push(`${a.name} (too large)`); continue; }
    try {
      const bytes = account.provider === 'gmail' ? await fetchGmailAttachment(s, account, own.messageId, a.id) : await fetchZohoAttachment(s, account, own.folderId || '', own.messageId, a.id);
      const mime = sniff(bytes);
      const ex = mime ? await extractText(bytes, mime) : null;
      if (ex?.status === 'done' && ex.text.trim()) {
        sources.push({ label: `Attachment: ${a.name}`, text: ex.text.trim(), maxChunks: pdfs.includes(a) ? MAX_PDF_CHUNKS : undefined });
        names.push(a.name);
      }
      else names.push(`${a.name} (not readable)`);
    } catch { names.push(`${a.name} (download failed)`); }
  }
  return { text: sources.map((x) => `[${x.label}]\n${x.text}`).join('\n\n'), sources, attachments: names };
}

async function pool<T>(list: T[], work: (t: T) => Promise<void>, stop: () => boolean) {
  const queue = [...list];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length && !stop()) await work(queue.shift()!); }));
}

/** Review new/changed mail of one view. Started from the view page or the scheduler; never runs twice at once. */
export async function runDigest(pipelineId: string): Promise<void> {
  if (digestProgress(pipelineId).running) return;
  const progress: Progress = { running: true, done: 0, total: 0, note: 'Syncing the folder…' };
  progressMap().set(pipelineId, progress);
  let error = '';
  try {
    let state = await readState();
    const pipeline = state.pipelines.find((p) => p.id === pipelineId);
    if (!pipeline || pipeline.parser !== 'digest') throw new Error('Not a weekly review view.');
    if (!state.ai.enabled || !aiConfigured(state)) throw new Error('Turn on AI in Settings → AI.');
    if (!state.ai.share.email || !state.ai.emailBodies) throw new Error('Allow email sharing and email bodies in Settings → AI.');
    // Newest mail first (a request-bound sync adds at most ~100 per folder).
    await updateStateDetached(async (s) => { const p = s.pipelines.find((x) => x.id === pipelineId); if (!p) return; await syncZohoPipeline(s, p); await syncGmailPipeline(s, p); }).catch((e) => { progress.note = `Sync failed (${e instanceof Error ? e.message : e}); using stored mail.`; });
    state = await readState();
    const view = state.pipelines.find((p) => p.id === pipelineId)!;
    const focus = focusOf(view), tz = tzOf(state), today = todayIn(tz);
    const prev = state.digests?.[pipelineId] || emptyDigest();
    const sessionsPrev = prev.sessions || emptySessions();
    const emails = emailsOf(state, view);
    const recent = Date.now() - DIGEST_DAYS * 86_400_000;
    // School mail: the window plus anything already reviewed (kept for future-dated items). Session reports: all kept.
    const school = emails.filter((e) => !e.session && Date.parse(e.receivedAt) >= recent).map((e) => ({ ...e, fp: reviewFingerprint(e, focus) }));
    const toReview = needsReview(school, prev.reviews);
    const sessions = emails.filter((e) => e.session).map((e) => ({ ...e, fp: sessionFingerprint(e) }));
    const toExtract = sessions.filter((e) => { const r = sessionsPrev.records[e.key]; return !r || r.fp !== e.fp || (r.error && (r.attempts || 0) < MAX_ATTEMPTS); });
    progress.total = toReview.length + toExtract.length;
    progress.note = progress.total ? `Reading ${progress.total} emails…` : 'Up to date.';
    const reviews: Record<string, EmailReview> = {}, records: NonNullable<DigestState['sessions']>['records'] = {};
    let stop = '';
    const fatal = (e: unknown) => e instanceof AiError && ['auth', 'forbidden', 'rate_limit', 'not_configured', 'disabled', 'cancelled'].includes(e.kind);
    // Bodies are read on one detached snapshot per email so refreshed tokens are saved.
    const read = async (e: Email) => { let out: Awaited<ReturnType<typeof readEmail>> = { text: '', sources: [], attachments: [] }; await updateStateDetached(async (s) => { out = await readEmail(s, view, e.item); }); return out; };
    await pool(toReview, async (e) => {
      const attempts = (prev.reviews[e.key]?.fp === e.fp ? prev.reviews[e.key]?.attempts || 0 : 0) + 1;
      try {
        const { sources, attachments } = await read(e);
        const reviewSources: ReadSource[] = sources.length ? sources : [{ label: 'Email body', text: e.item.summary }];
        const pieces = reviewSources.map((source) => {
          const result = chunkText(source.text, undefined, source.maxChunks);
          return { ...result, chunks: result.chunks.map((chunk) => `[${source.label}]\n${chunk}`) };
        });
        const chunks = pieces.flatMap((x) => x.chunks), truncated = pieces.some((x) => x.truncated);
        const parts = [];
        for (let i = 0; i < chunks.length; i++) {
          const r = await ask(state, reviewPrompt(focus, e, chunks[i], i + 1, chunks.length, today));
          const parsed = parseReview(r.reply);
          if (!parsed) throw new AiError('invalid_response', 'review');
          parts.push(parsed);
        }
        reviews[e.key] = { fp: e.fp, ...combineParts(parts), at: new Date().toISOString(), chunks: chunks.length, truncated, attachments, attempts };
      } catch (err) {
        if (fatal(err)) stop = describeError(err);
        else reviews[e.key] = { fp: e.fp, relevant: 'no', reason: '', items: [], at: new Date().toISOString(), chunks: 0, truncated: false, attachments: [], error: describeError(err).slice(0, 200), attempts };
      } finally { progress.done++; }
    }, () => Boolean(stop));
    await pool(toExtract, async (e) => {
      const attempts = (sessionsPrev.records[e.key]?.fp === e.fp ? sessionsPrev.records[e.key]?.attempts || 0 : 0) + 1;
      const label = sessionSourceOf(e.item)!.label;
      try {
        const { text } = await read(e);
        const r = await ask(state, sessionPrompt(label, e, text || e.item.summary));
        const session = parseSession(r.reply, new Date(e.receivedAt).toLocaleDateString('en-CA', { timeZone: tz }));
        if (!session) throw new AiError('invalid_response', 'session');
        records[e.key] = { fp: e.fp, source: label, at: new Date().toISOString(), session, attempts };
      } catch (err) {
        if (fatal(err)) stop = describeError(err);
        else records[e.key] = { fp: e.fp, source: label, at: new Date().toISOString(), session: null, error: describeError(err).slice(0, 200), attempts };
      } finally { progress.done++; }
    }, () => Boolean(stop));
    // Narrative only when the session data changed (one small call).
    let narrative = sessionsPrev.narrative;
    const merged = { ...sessionsPrev.records, ...records };
    const rows = sessions.flatMap((e) => (merged[e.key]?.session ? [{ ...merged[e.key].session!, key: e.key }] : []));
    if (rows.length >= 2 && !stop) {
      const basis = trendBasis(sessionTrends(rows, today));
      if (basis !== narrative?.basis) {
        try { const r = await ask(state, narrativePrompt(sessionSourceOf(sessions[0].item)!.label, childOf(view), basis)); narrative = { text: r.reply.trim().slice(0, 1500), at: new Date().toISOString(), basis }; }
        catch (err) { if (fatal(err)) stop = describeError(err); }
      }
    }
    const keepSchool = new Set(emails.filter((e) => !e.session).map((e) => e.key)), keepSessions = new Set(sessions.map((e) => e.key));
    await updateState((s) => {
      const d = (s.digests ||= {})[pipelineId] ||= emptyDigest();
      Object.assign(d.reviews, reviews);
      for (const k of Object.keys(d.reviews)) if (!keepSchool.has(k)) delete d.reviews[k];
      const ss = d.sessions ||= emptySessions();
      Object.assign(ss.records, records);
      for (const k of Object.keys(ss.records)) if (!keepSessions.has(k)) delete ss.records[k];
      if (narrative) ss.narrative = narrative;
      d.lastRun = new Date().toISOString(); d.error = stop;
    });
    progress.note = stop ? `Stopped: ${stop}` : 'Up to date.';
    error = stop;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    progress.note = error;
    await updateState((s) => { const d = (s.digests ||= {})[pipelineId] ||= emptyDigest(); d.error = error; }).catch(() => undefined);
  } finally { progress.running = false; }
  if (error) console.warn(`[aados] weekly review ${pipelineId}: ${error}`);
}

/** Scheduler hook: refresh each enabled review view at most every AUTO_EVERY_MS. */
export async function digestTick() {
  const state = await readState();
  if (!state.ai.enabled || !state.ai.emailBodies) return;
  for (const p of state.pipelines.filter((x) => x.parser === 'digest' && x.enabled)) {
    const last = Date.parse(state.digests?.[p.id]?.lastRun || '') || 0;
    if (Date.now() - last >= AUTO_EVERY_MS) await runDigest(p.id);
  }
}

/** Everything the view page shows. */
export function digestView(state: AadOSState, pipeline: Pipeline) {
  const d = state.digests?.[pipeline.id] || emptyDigest();
  const focus = focusOf(pipeline), today = todayIn(tzOf(state));
  const blocked = !state.ai.enabled ? 'Turn on AI in Settings → AI.'
    : !aiConfigured(state) ? 'Connect AJMCP in Settings → AI.'
    : !state.ai.share.email ? 'Allow Email in Settings → AI.'
    : !state.ai.emailBodies ? 'Allow full email text in Settings → AI.' : '';
  // A configuration error from an earlier run is stale once the corresponding settings are enabled.
  const error = blocked || (/^(Turn on AI|Connect AJMCP|Allow email sharing|Allow Email|Allow full email text)/.test(d.error) ? '' : d.error);
  const emails = emailsOf(state, pipeline);
  const school = emails.filter((e) => !e.session);
  const fps = Object.fromEntries(school.map((e) => [e.key, reviewFingerprint(e, focus)]));
  const digest = buildDigest(school.map(({ item: _i, session: _s, ...e }) => e), d, fps, today);
  const ss = d.sessions || emptySessions();
  const sessionEmails = emails.filter((e) => e.session);
  const rows: (Session & { key: string })[] = sessionEmails.flatMap((e) => (ss.records[e.key]?.session ? [{ ...ss.records[e.key].session!, key: e.key }] : []));
  const sessionFailed = sessionEmails.filter((e) => ss.records[e.key]?.error).length;
  const sessionPending = sessionEmails.filter((e) => !ss.records[e.key]).length;
  return {
    focus, lastRun: d.lastRun, error, progress: digestProgress(pipeline.id), digest, today,
    sessions: sessionEmails.length ? { label: sessionSourceOf(sessionEmails[0].item)!.label, trends: sessionTrends(rows, today), narrative: ss.narrative?.text || '', narrativeAt: ss.narrative?.at || '', failed: sessionFailed, pending: sessionPending } : null
  };
}

export type DigestViewData = ReturnType<typeof digestView>;

/** Dashboard: only open actions. Dates, updates and FYIs stay in the full report. */
export function digestAttention(state: AadOSState): Attention[] {
  const today = todayIn(tzOf(state));
  return state.pipelines.filter((p) => p.parser === 'digest' && state.digests?.[p.id]).flatMap((p) => {
    const { digest } = digestView(state, p);
    return digest.actions
      .filter((i) => !i.mark && (!i.due || i.due >= addDays(today, -3)))
      .map((i) => ({ id: `digest:${p.id}:${i.id}`, source: 'digest' as const, title: `${p.name}: ${i.title}`, why: [i.due ? (i.kind === 'action' ? `Due ${i.due}` : i.due) : '', i.detail].filter(Boolean).join(' · ').slice(0, 160), href: `/pipelines/${p.id}#review`, score: digestScore(i, today), at: i.sources[0]?.receivedAt }));
  });
}
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Mark an item done/dismissed (or clear) locally, or turn it into an Asana task (its link is remembered). */
export async function markDigestItem(pipelineId: string, itemId: string, op: 'done' | 'dismissed' | 'clear' | 'task') {
  if (op !== 'task') {
    await updateState((s) => {
      if (!s.pipelines.some((x) => x.id === pipelineId)) throw new Error('View not found.');
      const d = (s.digests ||= {})[pipelineId] ||= emptyDigest();
      if (op === 'clear') delete d.marks[itemId]; else d.marks[itemId] = op;
    });
    return '';
  }
  const s = await readState();
  const p = s.pipelines.find((x) => x.id === pipelineId);
  if (!p) throw new Error('View not found.');
  const prior = s.digests?.[pipelineId]?.tasks[itemId] || '';
  if (/^https?:/.test(prior)) return prior; // already sent to Asana
  if (!asana.connectedState(s)) throw new Error('Connect Asana first (Settings → Asana connection).');
  const v = digestView(s, p).digest;
  const item = [...v.actions, ...v.dates, ...v.updates, ...v.fyi].find((i) => i.id === itemId);
  if (!item) throw new Error('Item not found.');
  const c = await asana.connection();
  const notes = [item.detail, ...item.sources.map((x) => `${x.subject} (${x.receivedAt.slice(0, 10)})`)].filter(Boolean).join('\n').slice(0, 2000);
  const task = await asana.createTask(c, { name: `${p.name}: ${item.title}`.slice(0, 200), notes, due: item.due && /^\d{4}-\d{2}-\d{2}$/.test(item.due) ? duePayload(item.due, '', c.timeZone) : undefined });
  const link = task.permalink || 'https://app.asana.com/';
  await updateState((st) => { ((st.digests ||= {})[pipelineId] ||= emptyDigest()).tasks[itemId] = link; });
  return link;
}
