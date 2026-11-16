import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from '$env/dynamic/private';

export type PipelineParser = 'shop' | 'health' | 'generic';

export type ZohoFolder = { id: string; name: string; path: string; type: string };
export type Pipeline = {
  id: string;
  name: string;
  source: 'zoho' | 'gmail';
  folderId: string;
  folderName: string;
  parser: PipelineParser;
  enabled: boolean;
  cursor: number;
  lastSync: string;
  lastError: string;
};
export type PipelineItem = {
  id: string;
  pipelineId: string;
  messageId: string;
  subject: string;
  sender: string;
  receivedAt: string;
  summary: string;
  kind: string;
  stage: 'new' | 'reviewed' | 'ignored';
  facts: Record<string, string | number | boolean>;
};
type ZohoState = {
  clientId: string;
  clientSecret: string;
  dataCenter: string;
  connectedEmail: string;
  accountId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  apiDomain: string;
  oauthState: string;
  oauthStateExpiresAt: number;
  folders: ZohoFolder[];
};
type GmailState = { clientId: string; clientSecret: string; connectedEmail: string; accessToken: string; refreshToken: string; expiresAt: number; oauthState: string; oauthStateExpiresAt: number; folders: ZohoFolder[] };
export type AadOSState = { zoho: ZohoState; gmail: GmailState; pipelines: Pipeline[]; items: PipelineItem[] };

const emptyState = (): AadOSState => ({
  zoho: { clientId: '', clientSecret: '', dataCenter: 'com', connectedEmail: '', accountId: '', accessToken: '', refreshToken: '', expiresAt: 0, apiDomain: '', oauthState: '', oauthStateExpiresAt: 0, folders: [] },
  gmail: { clientId: '', clientSecret: '', connectedEmail: '', accessToken: '', refreshToken: '', expiresAt: 0, oauthState: '', oauthStateExpiresAt: 0, folders: [] },
  pipelines: [],
  items: []
});

const stateFile = () => join(env.AADOS_DATA_DIR || (env.NODE_ENV === 'production' ? '/data/aados' : join(process.cwd(), '.data')), 'state.enc');
const key = () => {
  const secret = env.AADOS_SESSION_SECRET || '';
  if (secret.length < 64) throw new Error('AADOS_SESSION_SECRET must contain at least 64 characters');
  return createHash('sha256').update(`aados-state-v1:${secret}`).digest();
};

function encrypt(state: AadOSState): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decrypt(value: string): AadOSState {
  const [version, iv, tag, ciphertext] = value.trim().split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Invalid AadOS state file');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const clear = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  const saved = JSON.parse(clear) as Partial<AadOSState>;
  const defaults = emptyState();
  return { ...defaults, ...saved, zoho: { ...defaults.zoho, ...(saved.zoho || {}) }, gmail: { ...defaults.gmail, ...(saved.gmail || {}) }, pipelines: (saved.pipelines || []).map((pipeline) => ({ ...pipeline, source: pipeline.source || 'zoho' })) } as AadOSState;
}

let queue = Promise.resolve();

export async function readState(): Promise<AadOSState> {
  try { return decrypt(await readFile(stateFile(), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    throw error;
  }
}

export async function updateState(change: (state: AadOSState) => void | Promise<void>): Promise<AadOSState> {
  let result = emptyState();
  queue = queue.catch(() => undefined).then(async () => {
    const state = await readState();
    await change(state);
    const file = stateFile();
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporary, encrypt(state), { mode: 0o600 });
    await rename(temporary, file);
    result = state;
  });
  await queue;
  return result;
}

export function publicState(state: AadOSState) {
  return {
    connected: Boolean(state.zoho.refreshToken && state.zoho.accountId),
    configured: Boolean(state.zoho.clientId && state.zoho.clientSecret),
    connectedEmail: state.zoho.connectedEmail,
    dataCenter: state.zoho.dataCenter,
    folders: state.zoho.folders,
    gmailConnected: Boolean(state.gmail.refreshToken),
    gmailConfigured: Boolean(state.gmail.clientId && state.gmail.clientSecret),
    gmailEmail: state.gmail.connectedEmail,
    gmailFolders: state.gmail.folders,
    pipelines: state.pipelines,
    itemCounts: Object.fromEntries(state.pipelines.map((pipeline) => [pipeline.id, state.items.filter((item) => item.pipelineId === pipeline.id).length]))
  };
}
