import { json } from '@sveltejs/kit';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from '$lib/server/aados-store';
import { migrateAjadvisor } from '$lib/finance/ajadvisor-import';

// Finance → Settings → Import from AJAdvisor (owner only). The uploaded SQLite file is a transient copy: opened read-only,
// used for one dry run or apply, then discarded. The owner's original AJAdvisor database is never touched.
export const POST = async ({ request, locals }) => {
  if (!locals.user?.owner) return json({ error: 'Only the owner can import financial data.' }, { status: 403 });
  const form = await request.formData();
  const file = form.get('file'), mode = form.get('mode') === 'apply' ? 'apply' : 'dry-run';
  if (!(file instanceof File) || !file.size) return json({ error: 'Choose your AJAdvisor database file (data/dev.db).' }, { status: 400 });
  if (file.size > 200 * 1024 * 1024) return json({ error: 'That file is too large for an AJAdvisor database.' }, { status: 400 });
  const dir = await mkdtemp(join(tmpdir(), 'aados-ajadvisor-'));
  const path = join(dir, 'dev.db');
  try {
    await writeFile(path, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
    const { DatabaseSync } = await import('node:sqlite');
    const sqlite = new DatabaseSync(path, { readOnly: true });
    const pool = await database();
    const client = await pool.connect();
    try {
      if (mode === 'dry-run') return json(await migrateAjadvisor(sqlite as any, client, 'dry-run'));
      await client.query('BEGIN');
      try { const report = await migrateAjadvisor(sqlite as any, client, 'apply'); await client.query('COMMIT'); return json(report); }
      catch (e) { await client.query('ROLLBACK'); throw e; }
    } finally { client.release(); sqlite.close(); }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Import failed.' }, { status: 400 });
  } finally { await rm(dir, { recursive: true, force: true }); }
};
