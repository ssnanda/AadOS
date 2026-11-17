import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import * as db from '../src/lib/server/ai/db.ts';

// Real PostgreSQL (skipped unless AADOS_TEST_DATABASE_URL names a *_test database). Own schema; the DDL mirrors
// apps/api/priv/repo/migrations/20261118000001_ai_and_documents.exs.
const url = process.env.AADOS_TEST_DATABASE_URL;
const skip = !url || !/_test$/.test(new URL(url).pathname) ? 'AADOS_TEST_DATABASE_URL not set' : false;
let pool: pg.Pool;
const DDL = `
CREATE TABLE IF NOT EXISTS ai_conversations (id varchar PRIMARY KEY, title varchar NOT NULL, inserted_at timestamp(0) NOT NULL, updated_at timestamp(0) NOT NULL);
CREATE TABLE IF NOT EXISTS ai_messages (id bigserial PRIMARY KEY, conversation_id varchar NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE, role varchar NOT NULL CHECK (role in ('user','assistant')), content text NOT NULL, sources jsonb NOT NULL DEFAULT '[]', provider varchar, model varchar, usage jsonb, latency_ms integer, error text, inserted_at timestamp(0) NOT NULL);
CREATE TABLE IF NOT EXISTS ai_insights (message_key varchar PRIMARY KEY, fingerprint varchar NOT NULL, status varchar NOT NULL CHECK (status in ('done','failed')), insight jsonb, error text, attempts integer NOT NULL DEFAULT 0, provider varchar, model varchar, reviewed_at timestamp(0), inserted_at timestamp(0) NOT NULL, updated_at timestamp(0) NOT NULL);
CREATE TABLE IF NOT EXISTS ai_drafts (id bigserial PRIMARY KEY, message_key varchar NOT NULL, content text NOT NULL, tone varchar, ai_generated boolean NOT NULL DEFAULT true, edited boolean NOT NULL DEFAULT false, inserted_at timestamp(0) NOT NULL, updated_at timestamp(0) NOT NULL);
CREATE TABLE IF NOT EXISTS ai_briefings (id bigserial PRIMARY KEY, content jsonb NOT NULL, provider varchar, model varchar, generated_at timestamp(0) NOT NULL);
CREATE TABLE IF NOT EXISTS documents (id varchar PRIMARY KEY, filename text NOT NULL, object_key varchar NOT NULL UNIQUE, mime varchar NOT NULL, size bigint NOT NULL, checksum varchar NOT NULL, folder varchar NOT NULL DEFAULT '', category varchar NOT NULL DEFAULT '', source_type varchar NOT NULL DEFAULT 'upload', source_ref varchar, extraction_status varchar NOT NULL DEFAULT 'pending' CHECK (extraction_status in ('pending','done','failed','unsupported')), extraction_error text, text text, inserted_at timestamp(0) NOT NULL, updated_at timestamp(0) NOT NULL,
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(filename,'') || ' ' || coalesce(folder,'') || ' ' || coalesce(category,'') || ' ' || left(coalesce(text,''), 1000000))) STORED);
CREATE UNIQUE INDEX IF NOT EXISTS documents_source_unique ON documents (source_type, source_ref) WHERE source_ref IS NOT NULL;`;

before(async () => {
  if (skip) return;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query('CREATE SCHEMA IF NOT EXISTS node_ai'); await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 6, options: '-c search_path=node_ai' });
  await pool.query(DDL);
});
after(async () => { if (pool) await pool.end(); });
const reset = () => pool.query('TRUNCATE ai_messages, ai_conversations, ai_insights, ai_drafts, ai_briefings, documents RESTART IDENTITY CASCADE');

test('conversations: create, messages with sources, rename, search, delete cascades', { skip }, async () => {
  await reset();
  const c = await db.createConversation(pool, '  What bills are due soon?  ');
  assert.equal(c.title, 'What bills are due soon?');
  await db.addMessage(pool, c.id, { role: 'user', content: 'What bills are due soon?' });
  const a = await db.addMessage(pool, c.id, { role: 'assistant', content: 'Electric bill [S1]', sources: [{ id: 'S1', kind: 'email', ref: 'g:1', title: 'Electric', date: '2026-11-17', href: '/emails', excerpt: '', meta: '' }], provider: 'openai', model: 'm', usage: { input_tokens: 5 }, latencyMs: 812 });
  assert.equal(a.sources[0].id, 'S1'); assert.equal(a.latencyMs, 812);
  const other = await db.createConversation(pool, 'Weekend plans');
  const got = await db.getConversation(pool, c.id);
  assert.deepEqual(got!.messages.map((m) => m.role), ['user', 'assistant']);
  assert.deepEqual((await db.listConversations(pool, 'electric')).map((x) => x.id), [c.id]); // searches message content too
  assert.equal((await db.listConversations(pool, '100%')).length, 0); // LIKE wildcards are escaped
  assert.equal(await db.renameConversation(pool, c.id, 'Bills'), true);
  assert.equal(await db.deleteConversation(pool, c.id), true);
  assert.equal(await db.getConversation(pool, c.id), null);
  assert.equal(Number((await pool.query('SELECT count(*) FROM ai_messages')).rows[0].count), 0);
  assert.equal((await db.listConversations(pool)).length, 1); assert.equal(await db.deleteConversation(pool, 'nope'), false);
  void other;
});

test('insights: idempotent upsert, failure attempts reset when content changes, reviewed flag, stats', { skip }, async () => {
  await reset();
  const insight = { summary: 'Bill', category: 'Bills', importance: 'high', needsReply: false, deadline: null, paymentDue: '2026-11-30', amount: '$82', renewalDate: null, appointment: null, suggestedTask: 'Pay', nextAction: 'Pay', confidence: 0.9, reason: 'x' } as any;
  await db.saveInsight(pool, 'g:1', 'fp1', { error: 'timeout' });
  await db.saveInsight(pool, 'g:1', 'fp1', { error: 'timeout' });
  assert.equal((await db.getInsights(pool, ['g:1'])).get('g:1')!.attempts, 2);
  await db.saveInsight(pool, 'g:1', 'fp2', { error: 'timeout' });
  assert.equal((await db.getInsights(pool, ['g:1'])).get('g:1')!.attempts, 1); // new content: fresh attempt budget
  await db.saveInsight(pool, 'g:1', 'fp2', { insight, provider: 'p', model: 'm' });
  await db.saveInsight(pool, 'g:2', 'fpx', { insight });
  const row = (await db.getInsights(pool, ['g:1', 'g:2', 'g:none'])).get('g:1')!;
  assert.deepEqual([row.status, row.insight!.paymentDue, row.provider], ['done', '2026-11-30', 'p']);
  assert.equal((await db.getInsights(pool, [])).size, 0);
  await db.markInsightReviewed(pool, 'g:1');
  assert.ok((await db.getInsights(pool, ['g:1'])).get('g:1')!.reviewedAt);
  assert.deepEqual([(await db.insightStats(pool)).done, (await db.insightStats(pool)).failed], [2, 0]);
});

test('drafts: AI draft, user edit keeps the edited flag, per-message isolation, delete', { skip }, async () => {
  await reset();
  const d = await db.saveDraft(pool, { key: 'g:1', content: 'Hi', tone: 'reply', aiGenerated: true, edited: false });
  const e = await db.saveDraft(pool, { id: d.id, key: 'g:1', content: 'Hi there', aiGenerated: true, edited: true });
  assert.deepEqual([e.id, e.edited, e.aiGenerated, e.content], [d.id, true, true, 'Hi there']);
  await assert.rejects(db.saveDraft(pool, { id: d.id, key: 'g:OTHER', content: 'hijack', aiGenerated: false, edited: true }), /Draft not found/);
  assert.equal((await db.listDrafts(pool, 'g:OTHER')).length, 0);
  await db.deleteDraft(pool, 'g:1', d.id); assert.equal((await db.listDrafts(pool, 'g:1')).length, 0);
});

test('briefing cache keeps only recent entries and returns the newest', { skip }, async () => {
  await reset();
  for (let i = 0; i < 12; i++) await db.saveBriefing(pool, { summary: `b${i}` }, 'p', 'm');
  assert.equal((await db.latestBriefing(pool))!.content.summary, 'b11');
  assert.equal(Number((await pool.query('SELECT count(*) FROM ai_briefings')).rows[0].count), 10);
});

test('documents: metadata, filters, full-text search with passages, dedupe by source, extraction status', { skip }, async () => {
  await reset();
  const base = { mime: 'application/pdf', size: 10, folder: 'Home', category: 'Housing', sourceType: 'upload', sourceRef: null };
  const lease = await db.insertDocument(pool, { ...base, id: '11111111-1111-1111-1111-111111111111', filename: 'lease-2026.pdf', objectKey: 'aados/documents/a', checksum: 'c1' });
  await db.insertDocument(pool, { ...base, id: '22222222-2222-2222-2222-222222222222', filename: 'receipt.png', objectKey: 'aados/documents/b', checksum: 'c2', mime: 'image/png', folder: 'Shopping', category: '' });
  await db.setExtraction(pool, lease.id, 'done', 'The monthly rent is $1,950. Termination requires 60 days notice.\u0000');
  assert.equal((await db.getDocument(pool, lease.id))!.hasText, true);
  assert.deepEqual((await db.listDocuments(pool, { q: 'termination' })).map((d) => d.filename), ['lease-2026.pdf']);
  assert.deepEqual((await db.listDocuments(pool, { type: 'image/png' })).map((d) => d.filename), ['receipt.png']);
  assert.deepEqual((await db.listDocuments(pool, { folder: 'Home' })).length, 1);
  assert.deepEqual(await db.documentFolders(pool), ['Home', 'Shopping']);
  const hits = await db.searchDocumentPassages(pool, db.tsTerms(['termination', "notice);DROP"]));
  assert.equal(hits[0].id, lease.id); assert.match(hits[0].excerpt, /60 days notice/);
  assert.equal((await db.searchDocumentPassages(pool, [], [lease.id]))[0].excerpt.startsWith('The monthly rent'), true);
  assert.deepEqual(await db.searchDocumentPassages(pool, []), []);
  await db.insertDocument(pool, { ...base, id: '33333333-3333-3333-3333-333333333333', filename: 'att.pdf', objectKey: 'aados/documents/c', checksum: 'c3', sourceType: 'email', sourceRef: 'g:1#att1' });
  assert.equal((await db.findDocumentBySource(pool, 'email', 'g:1#att1'))!.filename, 'att.pdf');
  await assert.rejects(db.insertDocument(pool, { ...base, id: '44444444-4444-4444-4444-444444444444', filename: 'dup.pdf', objectKey: 'aados/documents/d', checksum: 'c4', sourceType: 'email', sourceRef: 'g:1#att1' }), /duplicate key/);
  assert.equal((await db.findDocumentByChecksum(pool, 'c2'))!.filename, 'receipt.png');
  assert.equal(await db.updateDocument(pool, lease.id, { filename: 'Lease.pdf', folder: 'Legal' }), true);
  assert.equal((await db.getDocument(pool, lease.id))!.folder, 'Legal');
  assert.equal((await db.pendingExtractions(pool)).length, 2);
  assert.equal(await db.deleteDocument(pool, lease.id), true); assert.equal(await db.getDocument(pool, lease.id), null);
  assert.deepEqual(db.tsTerms(['a', 'Rent!', "x'y", 'ok']), ['rent', 'xy', 'ok']);
});
