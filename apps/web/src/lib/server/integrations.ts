// Effective AJMCP / RustFS settings: an environment variable (OpenShift Secret, or `bin/dev-local.sh config`) wins;
// otherwise the value saved in Settings (stored in the encrypted credential vault). Secrets never leave the server.
import { env } from '$env/dynamic/private';
import type { AadOSState } from './aados-store';

type Source = 'env' | 'settings' | '';
const pick = (e: string | undefined, s: string): [string, Source] => (e ? [e, 'env'] : s ? [s, 'settings'] : ['', '']);

export function ajmcpConfig(state: Pick<AadOSState, 'integrations'>) {
  const [url, urlFrom] = pick(env.AADOS_AJMCP_URL, state.integrations.ajmcp.url);
  const [token, tokenFrom] = pick(env.AADOS_AJMCP_TOKEN, state.integrations.ajmcp.token);
  return { url, token, from: { url: urlFrom, token: tokenFrom } };
}

const S3_KEYS = { endpoint: 'AADOS_S3_ENDPOINT', bucket: 'AADOS_S3_BUCKET', region: 'AADOS_S3_REGION', accessKey: 'AADOS_S3_ACCESS_KEY', secretKey: 'AADOS_S3_SECRET_KEY', prefix: 'AADOS_S3_PREFIX' } as const;
/** Env-shaped settings for storageConfigFromEnv(), merged from env and Settings. */
export function s3Env(state: Pick<AadOSState, 'integrations'>): Record<string, string | undefined> {
  const s = state.integrations.s3;
  const out: Record<string, string | undefined> = { AADOS_ALLOW_HTTP_HOSTS: env.AADOS_ALLOW_HTTP_HOSTS, AADOS_S3_TIMEOUT_MS: env.AADOS_S3_TIMEOUT_MS };
  for (const [field, name] of Object.entries(S3_KEYS)) out[name] = env[name] || (s[field as keyof typeof S3_KEYS] as string) || undefined;
  out.AADOS_S3_FORCE_PATH_STYLE = env.AADOS_S3_FORCE_PATH_STYLE || (s.forcePathStyle ? 'true' : 'false');
  return out;
}
/** Which S3 fields are fixed by the environment (shown read-only in Settings). */
export const s3EnvLocked = () => Object.fromEntries(Object.entries(S3_KEYS).map(([f, n]) => [f, Boolean(env[n])]).concat([['forcePathStyle', Boolean(env.AADOS_S3_FORCE_PATH_STYLE)]])) as Record<keyof typeof S3_KEYS | 'forcePathStyle', boolean>;
