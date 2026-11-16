// Credential vault: AES-256-GCM, same wire format as the Elixir `AadOS.Api.Vault`
// (12-byte IV, 16-byte tag, AAD "aados:cred:v1:" + scope), so either service can read what the other wrote.
// The key is AADOS_CREDENTIAL_ENCRYPTION_KEY (base64, 32 bytes) and is independent of the session secret. Pure Node.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const AAD = 'aados:cred:v1:';
export type Sealed = { keyVersion: number; iv: Buffer; tag: Buffer; ciphertext: Buffer };
export type Keyring = { current: [number, Buffer]; ring: Record<number, Buffer> };

function decodeKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  const key = Buffer.from(value.trim(), 'base64');
  return key.length === 32 ? key : null;
}
const version = (value: string | undefined, fallback: number) => (value && /^\d+$/.test(value) ? Number(value) : fallback);

/** Throws a clear error when the key is missing or malformed. */
export function keyringFromEnv(env: Record<string, string | undefined>): Keyring {
  const key = decodeKey(env.AADOS_CREDENTIAL_ENCRYPTION_KEY);
  if (!key) throw new Error('AADOS_CREDENTIAL_ENCRYPTION_KEY must be base64 of exactly 32 bytes (openssl rand -base64 32)');
  const current = version(env.AADOS_CREDENTIAL_KEY_VERSION, 1);
  const ring: Record<number, Buffer> = { [current]: key };
  const previous = decodeKey(env.AADOS_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS);
  if (previous) ring[version(env.AADOS_CREDENTIAL_KEY_VERSION_PREVIOUS, 0)] ??= previous;
  return { current: [current, key], ring };
}

export function seal(scope: string, payload: unknown, keyring: Keyring): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyring.current[1], iv);
  cipher.setAAD(Buffer.from(AAD + scope));
  const ciphertext = Buffer.concat([cipher.update(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { keyVersion: keyring.current[0], iv, tag: cipher.getAuthTag(), ciphertext };
}

/** Throws if the key version is unknown or authentication fails (wrong key, wrong scope, tampering). */
export function open(scope: string, sealed: Sealed, keyring: Keyring): string {
  const key = keyring.ring[sealed.keyVersion];
  if (!key) throw new Error(`credential encrypted with unknown key version ${sealed.keyVersion}`);
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.iv);
  decipher.setAAD(Buffer.from(AAD + scope));
  decipher.setAuthTag(sealed.tag);
  try { return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8'); }
  catch { throw new Error(`credential for ${scope} failed authentication (wrong key or tampered)`); }
}
