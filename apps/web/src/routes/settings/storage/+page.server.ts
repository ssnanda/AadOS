import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { database, hasDatabase, updateState, readState } from '$lib/server/aados-store';
import { storage, storageStatus } from '$lib/server/documents/service';
import { storageError } from '$lib/server/documents/storage';

export const load: PageServerLoad = async () => {
  const state = await readState();
  let usage: { files: number; bytes: number } | null = null;
  if (hasDatabase()) {
    const r = (await (await database()).query('SELECT count(*) AS n, coalesce(sum(size),0) AS b FROM documents').catch(() => ({ rows: [] as any[] }))).rows[0];
    if (r) usage = { files: Number(r.n), bytes: Number(r.b) };
  }
  return { status: storageStatus(), usage, lastOk: (state as unknown as { storageOk?: string }).storageOk || '' };
};

export const actions: Actions = {
  // HEAD on the configured bucket only; never lists or touches other buckets.
  test: async () => {
    try {
      await storage().test();
      await updateState((s) => { (s as unknown as { storageOk: string }).storageOk = new Date().toISOString(); });
      return { message: 'Connected: the bucket is reachable with these credentials.' };
    } catch (e) { return fail(400, { error: e instanceof Error && e.message.startsWith('Document storage') ? e.message : storageError(e) }); }
  }
};
