// Adapter for the owner's EXISTING RustFS server (S3-compatible). AadOS only ever touches the one configured bucket
// and only keys under its own prefix; object keys are generated (UUIDs), never derived from user filenames.
// Credentials come from server env only and are never returned to the browser or logged.
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

export type StorageConfig = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean; prefix: string; timeoutMs: number };
export type StorageStatus = { configured: boolean; endpoint: string; bucket: string; problem: string };
type Send = (command: any) => Promise<any>;

const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const loopback = (h: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(h);

/** Reads AADOS_S3_* from env. Returns the config plus a human problem string when incomplete/invalid (no secrets in it). */
export function storageConfigFromEnv(env: Record<string, string | undefined>): { config: StorageConfig | null; status: StorageStatus } {
  const endpoint = (env.AADOS_S3_ENDPOINT || '').trim().replace(/\/+$/, ''), bucket = (env.AADOS_S3_BUCKET || '').trim();
  const base = { configured: false, endpoint: '', bucket, problem: '' };
  if (!endpoint && !bucket) return { config: null, status: { ...base, problem: 'Not configured' } };
  let url: URL;
  try { url = new URL(endpoint); } catch { return { config: null, status: { ...base, problem: 'AADOS_S3_ENDPOINT is not a valid URL' } }; }
  const shown = `${url.protocol}//${url.host}`;
  const httpHosts = (env.AADOS_ALLOW_HTTP_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (loopback(url.hostname) || httpHosts.includes(url.hostname)))) return { config: null, status: { ...base, endpoint: shown, problem: 'RustFS endpoint must use HTTPS' } };
  if (!BUCKET.test(bucket)) return { config: null, status: { ...base, endpoint: shown, problem: 'AADOS_S3_BUCKET is missing or invalid' } };
  if (!env.AADOS_S3_ACCESS_KEY || !env.AADOS_S3_SECRET_KEY) return { config: null, status: { ...base, endpoint: shown, problem: 'AADOS_S3_ACCESS_KEY / AADOS_S3_SECRET_KEY missing' } };
  const prefix = (env.AADOS_S3_PREFIX ?? 'aados/').replace(/[^A-Za-z0-9/_-]/g, '').replace(/\/{2,}/g, '/').replace(/^\/+/, '');
  return {
    config: { endpoint: shown + url.pathname.replace(/\/+$/, ''), bucket, region: env.AADOS_S3_REGION || 'us-east-1', accessKeyId: env.AADOS_S3_ACCESS_KEY, secretAccessKey: env.AADOS_S3_SECRET_KEY, forcePathStyle: env.AADOS_S3_FORCE_PATH_STYLE !== 'false', prefix: prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix, timeoutMs: Number(env.AADOS_S3_TIMEOUT_MS) || 30_000 },
    status: { configured: true, endpoint: shown, bucket, problem: '' }
  };
}

/** Friendly, secret-free error text. */
export function storageError(e: unknown): string {
  const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number }; message?: string };
  const status = err?.$metadata?.httpStatusCode;
  const name = err?.name || err?.Code || '';
  if (name === 'NotFound' || name === 'NoSuchBucket' || status === 404) return 'Bucket or object not found';
  if (status === 403 || /AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch/.test(name)) return 'Access denied (check the RustFS access key, secret and bucket policy)';
  if (name === 'TimeoutError' || /timeout|ETIMEDOUT/i.test(err?.message || '')) return 'RustFS did not answer in time';
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|socket/i.test(err?.message || '') || name === 'NetworkingError') return 'Cannot reach the RustFS endpoint';
  if (/certificate|self.signed|TLS/i.test(err?.message || '')) return 'TLS certificate verification failed for the RustFS endpoint';
  return status ? `RustFS error (HTTP ${status})` : 'RustFS request failed';
}

export function createStorage(cfg: StorageConfig, send?: Send) {
  const client = send ? null : new S3Client({ endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: cfg.forcePathStyle, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }, requestHandler: { requestTimeout: cfg.timeoutMs, connectionTimeout: Math.min(cfg.timeoutMs, 10_000) } as never, maxAttempts: 3 });
  const run: Send = send ?? ((c) => client!.send(c));
  const own = (key: string) => { if (!key.startsWith(cfg.prefix) || key.includes('..') || key.includes('//')) throw new Error('object key outside the AadOS prefix'); return key; };
  return {
    bucket: cfg.bucket,
    /** New random key for a document; nothing user-controlled in it. */
    newKey: (kind = 'documents') => `${cfg.prefix}${kind}/${randomUUID()}`,
    async test(): Promise<void> { await run(new HeadBucketCommand({ Bucket: cfg.bucket })); },
    async put(key: string, body: Uint8Array, contentType: string, checksumSha256Hex: string): Promise<void> {
      await run(new PutObjectCommand({ Bucket: cfg.bucket, Key: own(key), Body: body, ContentType: contentType, ContentLength: body.byteLength, Metadata: { sha256: checksumSha256Hex } }));
    },
    async get(key: string): Promise<{ body: Uint8Array; contentType: string }> {
      const r = await run(new GetObjectCommand({ Bucket: cfg.bucket, Key: own(key) }));
      const bytes: Uint8Array = r.Body?.transformToByteArray ? await r.Body.transformToByteArray() : new Uint8Array(r.Body || []);
      return { body: bytes, contentType: r.ContentType || 'application/octet-stream' };
    },
    async exists(key: string): Promise<boolean> {
      try { await run(new HeadObjectCommand({ Bucket: cfg.bucket, Key: own(key) })); return true; }
      catch (e) { if ((e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404 || (e as { name?: string }).name === 'NotFound') return false; throw e; }
    },
    async remove(key: string): Promise<void> { await run(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: own(key) })); }
  };
}
export type Storage = ReturnType<typeof createStorage>;
