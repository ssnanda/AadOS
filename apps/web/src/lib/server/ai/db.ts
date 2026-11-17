// Relational persistence for AI conversations, email insights, drafts, briefings and document metadata.
// Plain parameterised SQL on the shared pool (tables come from the API's Ecto migrations). Testable with a real
// PostgreSQL (tests/ai-db.test.ts). Never stores provider credentials.
import { randomUUID } from 'node:crypto';
import type { Source } from './context.ts';
import type { Insight } from './email-ai.ts';

export type Q = { query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
export type Conversation = { id: string; title: string; updatedAt: string; preview?: string };
export type Message = { id: number; role: 'user' | 'assistant'; content: string; sources: Source[]; provider: string; model: string; usage: Record<string, number> | null; latencyMs: number | null; error: string; createdAt: string };
export type Doc = { id: string; filename: string; objectKey: string; mime: string; size: number; checksum: string; folder: string; category: string; sourceType: string; sourceRef: string | null; extractionStatus: string; extractionError: string; createdAt: string; updatedAt: string; hasText: boolean };

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v || ''));
const msg = (r: any): Message => ({ id: Number(r.id), role: r.role, content: r.content, sources: Array.isArray(r.sources) ? r.sources : [], provider: r.provider || '', model: r.model || '', usage: r.usage || null, latencyMs: r.latency_ms ?? null, error: r.error || '', createdAt: iso(r.inserted_at) });
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// ---------------- conversations ----------------
export async function listConversations(db: Q, q = '', limit = 100): Promise<Conversation[]> {
  const rows = q
    ? (await db.query(`SELECT c.id, c.title, c.updated_at FROM ai_conversations c WHERE c.title ILIKE $1 OR EXISTS (SELECT 1 FROM ai_messages m WHERE m.conversation_id = c.id AND m.content ILIKE $1) ORDER BY c.updated_at DESC LIMIT $2`, [like(q), limit])).rows
    : (await db.query('SELECT id, title, updated_at FROM ai_conversations ORDER BY updated_at DESC LIMIT $1', [limit])).rows;
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: iso(r.updated_at) }));
}
export async function createConversation(db: Q, title: string): Promise<Conversation> {
  const id = randomUUID();
  const t = title.trim().slice(0, 120) || 'New conversation';
  await db.query('INSERT INTO ai_conversations (id, title, inserted_at, updated_at) VALUES ($1, $2, now(), now())', [id, t]);
  return { id, title: t, updatedAt: new Date().toISOString() };
}
export async function getConversation(db: Q, id: string): Promise<{ conversation: Conversation; messages: Message[] } | null> {
  const c = (await db.query('SELECT id, title, updated_at FROM ai_conversations WHERE id = $1', [id])).rows[0];
  if (!c) return null;
  const messages = (await db.query('SELECT * FROM ai_messages WHERE conversation_id = $1 ORDER BY inserted_at, id', [id])).rows.map(msg);
  return { conversation: { id: c.id, title: c.title, updatedAt: iso(c.updated_at) }, messages };
}
export async function renameConversation(db: Q, id: string, title: string): Promise<boolean> {
  return ((await db.query('UPDATE ai_conversations SET title = $2, updated_at = now() WHERE id = $1', [id, title.trim().slice(0, 120) || 'Conversation'])).rowCount || 0) > 0;
}
export async function deleteConversation(db: Q, id: string): Promise<boolean> {
  return ((await db.query('DELETE FROM ai_conversations WHERE id = $1', [id])).rowCount || 0) > 0; // messages cascade
}
export async function addMessage(db: Q, conversationId: string, m: { role: 'user' | 'assistant'; content: string; sources?: Source[]; provider?: string; model?: string; usage?: Record<string, number> | null; latencyMs?: number | null; error?: string }): Promise<Message> {
  const r = (await db.query(`INSERT INTO ai_messages (conversation_id, role, content, sources, provider, model, usage, latency_ms, error, inserted_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8,$9, now()) RETURNING *`,
    [conversationId, m.role, m.content.slice(0, 20000), JSON.stringify(m.sources || []), m.provider || null, m.model || null, m.usage ? JSON.stringify(m.usage) : null, m.latencyMs ?? null, m.error || null])).rows[0];
  await db.query('UPDATE ai_conversations SET updated_at = now() WHERE id = $1', [conversationId]);
  return msg(r);
}
export async function deleteMessage(db: Q, conversationId: string, id: number) { await db.query('DELETE FROM ai_messages WHERE conversation_id = $1 AND id = $2', [conversationId, id]); }

// ---------------- email insights ----------------
export type InsightRow = { key: string; fingerprint: string; status: 'done' | 'failed'; insight: Insight | null; error: string; attempts: number; provider: string; model: string; reviewedAt: string; updatedAt: string };
const insightRow = (r: any): InsightRow => ({ key: r.message_key, fingerprint: r.fingerprint, status: r.status, insight: r.insight || null, error: r.error || '', attempts: r.attempts, provider: r.provider || '', model: r.model || '', reviewedAt: r.reviewed_at ? iso(r.reviewed_at) : '', updatedAt: iso(r.updated_at) });
export async function getInsights(db: Q, keys: string[]): Promise<Map<string, InsightRow>> {
  if (!keys.length) return new Map();
  const rows = (await db.query('SELECT * FROM ai_insights WHERE message_key = ANY($1::text[])', [keys])).rows;
  return new Map(rows.map((r) => [r.message_key, insightRow(r)]));
}
export async function saveInsight(db: Q, key: string, fp: string, result: { insight: Insight; provider?: string; model?: string } | { error: string }) {
  if ('insight' in result) await db.query(`INSERT INTO ai_insights (message_key, fingerprint, status, insight, error, attempts, provider, model, inserted_at, updated_at) VALUES ($1,$2,'done',$3::jsonb,NULL,1,$4,$5,now(),now())
    ON CONFLICT (message_key) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, status = 'done', insight = EXCLUDED.insight, error = NULL, attempts = ai_insights.attempts + 1, provider = EXCLUDED.provider, model = EXCLUDED.model, updated_at = now()`, [key, fp, JSON.stringify(result.insight), result.provider || null, result.model || null]);
  else await db.query(`INSERT INTO ai_insights (message_key, fingerprint, status, error, attempts, inserted_at, updated_at) VALUES ($1,$2,'failed',$3,1,now(),now())
    ON CONFLICT (message_key) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, status = 'failed', error = EXCLUDED.error, attempts = CASE WHEN ai_insights.fingerprint = EXCLUDED.fingerprint THEN ai_insights.attempts + 1 ELSE 1 END, updated_at = now()`, [key, fp, result.error.slice(0, 300)]);
}
export async function markInsightReviewed(db: Q, key: string) { await db.query('UPDATE ai_insights SET reviewed_at = now(), updated_at = now() WHERE message_key = $1', [key]); }
export async function insightStats(db: Q) {
  const r = (await db.query(`SELECT count(*) FILTER (WHERE status='done') AS done, count(*) FILTER (WHERE status='failed') AS failed, max(updated_at) AS last FROM ai_insights`)).rows[0];
  return { done: Number(r.done), failed: Number(r.failed), last: r.last ? iso(r.last) : '' };
}

// ---------------- drafts ----------------
export type Draft = { id: number; key: string; content: string; tone: string; aiGenerated: boolean; edited: boolean; updatedAt: string };
const draftRow = (r: any): Draft => ({ id: Number(r.id), key: r.message_key, content: r.content, tone: r.tone || '', aiGenerated: r.ai_generated, edited: r.edited, updatedAt: iso(r.updated_at) });
export async function listDrafts(db: Q, key: string): Promise<Draft[]> { return (await db.query('SELECT * FROM ai_drafts WHERE message_key = $1 ORDER BY updated_at DESC LIMIT 20', [key])).rows.map(draftRow); }
export async function saveDraft(db: Q, d: { id?: number; key: string; content: string; tone?: string; aiGenerated: boolean; edited: boolean }): Promise<Draft> {
  const content = d.content.slice(0, 10000);
  const r = d.id
    ? (await db.query('UPDATE ai_drafts SET content = $3, tone = COALESCE($4, tone), edited = edited OR $5, updated_at = now() WHERE id = $1 AND message_key = $2 RETURNING *', [d.id, d.key, content, d.tone || null, d.edited])).rows[0]
    : (await db.query('INSERT INTO ai_drafts (message_key, content, tone, ai_generated, edited, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,now(),now()) RETURNING *', [d.key, content, d.tone || null, d.aiGenerated, d.edited])).rows[0];
  if (!r) throw new Error('Draft not found');
  return draftRow(r);
}
export async function deleteDraft(db: Q, key: string, id: number) { await db.query('DELETE FROM ai_drafts WHERE id = $1 AND message_key = $2', [id, key]); }

// ---------------- briefing cache ----------------
export async function latestBriefing(db: Q): Promise<{ content: any; provider: string; model: string; generatedAt: string } | null> {
  const r = (await db.query('SELECT * FROM ai_briefings ORDER BY generated_at DESC, id DESC LIMIT 1')).rows[0];
  return r ? { content: r.content, provider: r.provider || '', model: r.model || '', generatedAt: iso(r.generated_at) } : null;
}
export async function saveBriefing(db: Q, content: unknown, provider = '', model = '') {
  await db.query('INSERT INTO ai_briefings (content, provider, model, generated_at) VALUES ($1::jsonb, $2, $3, now())', [JSON.stringify(content), provider || null, model || null]);
  await db.query('DELETE FROM ai_briefings WHERE id NOT IN (SELECT id FROM ai_briefings ORDER BY generated_at DESC, id DESC LIMIT 10)'); // keep a short history
}

// ---------------- documents ----------------
const docRow = (r: any): Doc => ({ id: r.id, filename: r.filename, objectKey: r.object_key, mime: r.mime, size: Number(r.size), checksum: r.checksum, folder: r.folder, category: r.category, sourceType: r.source_type, sourceRef: r.source_ref, extractionStatus: r.extraction_status, extractionError: r.extraction_error || '', createdAt: iso(r.inserted_at), updatedAt: iso(r.updated_at), hasText: Boolean(r.has_text) });
const DOC_COLS = 'id, filename, object_key, mime, size, checksum, folder, category, source_type, source_ref, extraction_status, extraction_error, inserted_at, updated_at, (text IS NOT NULL AND text <> \'\') AS has_text';
export async function insertDocument(db: Q, d: Omit<Doc, 'createdAt' | 'updatedAt' | 'hasText' | 'extractionStatus' | 'extractionError'> & { extractionStatus?: string }): Promise<Doc> {
  const r = (await db.query(`INSERT INTO documents (id, filename, object_key, mime, size, checksum, folder, category, source_type, source_ref, extraction_status, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now()) RETURNING ${DOC_COLS}`,
    [d.id, d.filename, d.objectKey, d.mime, d.size, d.checksum, d.folder, d.category, d.sourceType, d.sourceRef, d.extractionStatus || 'pending'])).rows[0];
  return docRow(r);
}
export async function getDocument(db: Q, id: string): Promise<Doc | null> { const r = (await db.query(`SELECT ${DOC_COLS} FROM documents WHERE id = $1`, [id])).rows[0]; return r ? docRow(r) : null; }
export async function findDocumentBySource(db: Q, sourceType: string, sourceRef: string): Promise<Doc | null> { const r = (await db.query(`SELECT ${DOC_COLS} FROM documents WHERE source_type = $1 AND source_ref = $2`, [sourceType, sourceRef])).rows[0]; return r ? docRow(r) : null; }
export async function findDocumentByChecksum(db: Q, checksum: string): Promise<Doc | null> { const r = (await db.query(`SELECT ${DOC_COLS} FROM documents WHERE checksum = $1 ORDER BY inserted_at LIMIT 1`, [checksum])).rows[0]; return r ? docRow(r) : null; }
export type DocFilter = { q?: string; type?: string; folder?: string; from?: string; to?: string; limit?: number };
export async function listDocuments(db: Q, f: DocFilter = {}): Promise<Doc[]> {
  const where: string[] = [], params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.q) where.push(`(search @@ plainto_tsquery('simple', ${p(f.q)}) OR filename ILIKE ${p(like(f.q))})`);
  if (f.type) where.push(`mime = ${p(f.type)}`);
  if (f.folder) where.push(`folder = ${p(f.folder)}`);
  if (f.from) where.push(`inserted_at >= ${p(f.from)}::date`);
  if (f.to) where.push(`inserted_at < (${p(f.to)}::date + 1)`);
  const sql = `SELECT ${DOC_COLS} FROM documents ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY inserted_at DESC LIMIT ${Math.min(Math.max(f.limit || 200, 1), 500)}`;
  return (await db.query(sql, params)).rows.map(docRow);
}
export async function documentFolders(db: Q): Promise<string[]> { return (await db.query(`SELECT DISTINCT folder FROM documents WHERE folder <> '' ORDER BY folder`)).rows.map((r) => r.folder); }
export async function updateDocument(db: Q, id: string, patch: { filename?: string; folder?: string; category?: string }): Promise<boolean> {
  return ((await db.query('UPDATE documents SET filename = COALESCE($2, filename), folder = COALESCE($3, folder), category = COALESCE($4, category), updated_at = now() WHERE id = $1', [id, patch.filename ?? null, patch.folder ?? null, patch.category ?? null])).rowCount || 0) > 0;
}
export async function deleteDocument(db: Q, id: string): Promise<boolean> { return ((await db.query('DELETE FROM documents WHERE id = $1', [id])).rowCount || 0) > 0; }
export async function setExtraction(db: Q, id: string, status: 'done' | 'failed' | 'unsupported' | 'pending', text: string | null, error = '') {
  await db.query('UPDATE documents SET extraction_status = $2, text = $3, extraction_error = $4, updated_at = now() WHERE id = $1', [id, status, text ? text.replace(/\u0000/g, '').slice(0, 2_000_000) : null, error ? error.slice(0, 300) : null]);
}
export async function pendingExtractions(db: Q, limit = 5): Promise<Doc[]> { return (await db.query(`SELECT ${DOC_COLS} FROM documents WHERE extraction_status = 'pending' ORDER BY inserted_at LIMIT $1`, [limit])).rows.map(docRow); }
export async function documentText(db: Q, id: string): Promise<string> { return (await db.query('SELECT text FROM documents WHERE id = $1', [id])).rows[0]?.text || ''; }
/** Full-text search with highlighted passages (for the assistant); only authorised = this owner's documents. */
export async function searchDocumentPassages(db: Q, terms: string[], ids: string[] = [], limit = 5): Promise<{ id: string; filename: string; date: string; category: string; excerpt: string }[]> {
  const params: unknown[] = [];
  const conds: string[] = [];
  if (terms.length) { params.push(terms.join(' | ')); conds.push(`search @@ to_tsquery('simple', $${params.length})`); }
  if (ids.length) { params.push(ids); conds.push(`id = ANY($${params.length}::text[])`); }
  if (!conds.length) return [];
  const q = terms.length ? `ts_headline('simple', coalesce(text, filename), to_tsquery('simple', $1), 'MaxWords=60, MinWords=20, MaxFragments=2, FragmentDelimiter=" … "')` : 'left(coalesce(text, \'\'), 1200)';
  const rows = (await db.query(`SELECT id, filename, category, inserted_at, ${q} AS excerpt FROM documents WHERE ${conds.join(' AND ')} ORDER BY ${terms.length ? `ts_rank(search, to_tsquery('simple', $1)) DESC,` : ''} inserted_at DESC LIMIT ${Math.min(limit, 10)}`, params)).rows;
  return rows.map((r) => ({ id: r.id, filename: r.filename, category: r.category, date: iso(r.inserted_at), excerpt: String(r.excerpt || '').replace(/<\/?b>/g, '') }));
}
/** Sanitised tsquery words (letters/digits only) so user text can never break the query syntax. */
export const tsTerms = (terms: string[]) => terms.map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter((t) => t.length > 1).slice(0, 8);
