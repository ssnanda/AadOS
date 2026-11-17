import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { database, hasDatabase, updateState, readState } from '$lib/server/aados-store';
import { storage, storageStatus } from '$lib/server/documents/service';
import { storageConfigFromEnv, storageError } from '$lib/server/documents/storage';
import { env } from '$env/dynamic/private';
import { s3Env, s3EnvLocked } from '$lib/server/integrations';

export const load: PageServerLoad = async () => {
  const state = await readState();
  let usage: { files: number; bytes: number } | null = null;
  if (hasDatabase()) {
    const r = (await (await database()).query('SELECT count(*) AS n, coalesce(sum(size),0) AS b FROM documents').catch(() => ({ rows: [] as any[] }))).rows[0];
    if (r) usage = { files: Number(r.n), bytes: Number(r.b) };
  }
  const s = state.integrations.s3, merged = s3Env(state);
  // Keys are never sent to the page: only whether they are saved and whether the environment fixes a field.
  return {
    status: await storageStatus(), usage, lastOk: state.storageOk || '', locked: s3EnvLocked(),
    form: { endpoint: merged.AADOS_S3_ENDPOINT || '', bucket: merged.AADOS_S3_BUCKET || '', region: merged.AADOS_S3_REGION || '', prefix: s.prefix, forcePathStyle: merged.AADOS_S3_FORCE_PATH_STYLE !== 'false', hasAccessKey: Boolean(merged.AADOS_S3_ACCESS_KEY), hasSecretKey: Boolean(merged.AADOS_S3_SECRET_KEY) }
  };
};

export const actions: Actions = {
  save: async ({ request }) => {
    const f = await request.formData();
    const text = (k: string, max = 300) => String(f.get(k) ?? '').trim().slice(0, max);
    const current = (await readState()).integrations.s3;
    const next = { endpoint: text('endpoint').replace(/\/+$/, ''), bucket: text('bucket', 63), region: text('region', 40), prefix: text('prefix', 60),
      forcePathStyle: f.get('forcePathStyle') === 'on', accessKey: text('accessKey', 200) || current.accessKey, secretKey: text('secretKey', 200) || current.secretKey };
    if (f.get('clearKeys') === 'on') { next.accessKey = ''; next.secretKey = ''; }
    // Validate with the same rules the adapter uses (HTTPS, bucket name, both keys) before saving anything.
    // The submitted values must be valid on their own (an environment variable may override them today, but not forever).
    const probe = storageConfigFromEnv({ AADOS_S3_ENDPOINT: next.endpoint, AADOS_S3_BUCKET: next.bucket, AADOS_S3_ACCESS_KEY: next.accessKey, AADOS_S3_SECRET_KEY: next.secretKey, AADOS_S3_PREFIX: next.prefix, AADOS_ALLOW_HTTP_HOSTS: env.AADOS_ALLOW_HTTP_HOSTS });
    if (!probe.config && probe.status.problem !== 'Not configured' && !(f.get('clearKeys') === 'on' && /ACCESS_KEY/.test(probe.status.problem))) return fail(400, { error: probe.status.problem });
    await updateState((s) => { s.integrations.s3 = next; });
    return { message: 'Storage settings saved.' };
  },
  // HEAD on the configured bucket only; never lists or touches other buckets.
  test: async () => {
    try {
      await (await storage()).test();
      await updateState((s) => { s.storageOk = new Date().toISOString(); });
      return { message: 'Connected: the bucket is reachable with these credentials.' };
    } catch (e) { return fail(400, { error: e instanceof Error && e.message.startsWith('Document storage') ? e.message : storageError(e) }); }
  }
};
