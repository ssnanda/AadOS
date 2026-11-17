// Documents: file content in the owner's RustFS bucket, metadata + extracted text in PostgreSQL.
import { database, readState } from '../aados-store';
import { s3Env } from '../integrations';
import { createStorage, storageConfigFromEnv, storageError, type Storage } from './storage';
import { checkUpload, type Mime } from './validate';
import { extractText } from './extract';
import { deleteDocument, findDocumentByChecksum, findDocumentBySource, getDocument, insertDocument, pendingExtractions, setExtraction, type Doc } from '../ai/db';

let cache: { key: string; storage: Storage } | null = null;
export const storageStatus = async () => storageConfigFromEnv(s3Env(await readState())).status;
export async function storage(): Promise<Storage> {
  const { config, status } = storageConfigFromEnv(s3Env(await readState()));
  if (!config) throw new Error(`Document storage is not available: ${status.problem}.`);
  const key = JSON.stringify(config);
  if (cache?.key !== key) cache = { key, storage: createStorage(config) };
  return cache.storage;
}

export type UploadResult = { doc: Doc; duplicate: boolean };
/**
 * Validate -> dedupe (same content, or same email attachment) -> put object -> insert metadata -> extract in background.
 * If the metadata insert fails the object is removed again, so no orphan files are left in the bucket.
 */
export async function saveDocument(bytes: Uint8Array, filename: string, meta: { folder?: string; category?: string; sourceType?: string; sourceRef?: string | null } = {}): Promise<UploadResult> {
  const checked = checkUpload(bytes, filename);
  if (!checked.ok) throw new Error(checked.error);
  const db = await database();
  if (meta.sourceRef) { const existing = await findDocumentBySource(db, meta.sourceType || 'upload', meta.sourceRef); if (existing) return { doc: existing, duplicate: true }; }
  const same = await findDocumentByChecksum(db, checked.checksum);
  if (same && !meta.sourceRef) return { doc: same, duplicate: true };
  const s = await storage();
  const objectKey = s.newKey();
  try { await s.put(objectKey, bytes, checked.mime, checked.checksum); } catch (e) { throw new Error(`Upload to RustFS failed: ${storageError(e)}.`); }
  let doc: Doc;
  try {
    doc = await insertDocument(db, { id: crypto.randomUUID(), filename: checked.filename, objectKey, mime: checked.mime, size: checked.size, checksum: checked.checksum, folder: (meta.folder || '').trim().slice(0, 80), category: (meta.category || '').trim().slice(0, 60), sourceType: meta.sourceType || 'upload', sourceRef: meta.sourceRef || null });
  } catch (e) { await s.remove(objectKey).catch(() => undefined); throw e; }
  void extractOne(doc.id, bytes, checked.mime);
  return { doc, duplicate: false };
}

async function extractOne(id: string, bytes: Uint8Array, mime: Mime) {
  try { const db = await database(); const r = await extractText(bytes, mime); await setExtraction(db, id, r.status, r.text || null, r.error); }
  catch (e) { console.warn('[aados] extraction failed:', e instanceof Error ? e.message : e); }
}

/** Background sweep for documents still pending (e.g. after a restart, or a retry). */
export async function extractionPass(limit = 3) {
  const db = await database();
  for (const doc of await pendingExtractions(db, limit)) {
    try { const { body } = await (await storage()).get(doc.objectKey); const r = await extractText(body, doc.mime as Mime); await setExtraction(db, doc.id, r.status, r.text || null, r.error); }
    catch (e) { await setExtraction(db, doc.id, 'failed', null, storageError(e)); }
  }
}

export async function readDocument(id: string): Promise<{ doc: Doc; body: Uint8Array } | null> {
  const db = await database();
  const doc = await getDocument(db, id);
  if (!doc) return null;
  try { return { doc, body: (await (await storage()).get(doc.objectKey)).body }; } catch (e) { throw new Error(storageError(e)); }
}

/** Remove the object, then the metadata. A missing object is fine (already gone); other storage errors keep the record. */
export async function removeDocument(id: string): Promise<boolean> {
  const db = await database();
  const doc = await getDocument(db, id);
  if (!doc) return false;
  try { const s = await storage(); if (await s.exists(doc.objectKey)) await s.remove(doc.objectKey); } catch (e) { throw new Error(`Could not delete the file from RustFS: ${storageError(e)}. Nothing was removed.`); }
  return deleteDocument(db, id);
}

declare global { var __aadosExtractTimer: ReturnType<typeof setInterval> | undefined; }
export function startExtractionWorker() {
  if (globalThis.__aadosExtractTimer) return;
  // Cheap when nothing is pending or storage is not configured (the pass simply finds nothing to do / fails per doc).
  globalThis.__aadosExtractTimer = setInterval(async () => { if ((await storageStatus()).configured) extractionPass().catch(() => undefined); }, 120_000);
  globalThis.__aadosExtractTimer.unref?.();
}
