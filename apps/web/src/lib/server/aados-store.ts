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
  accountId: string;
  folderId: string;
  folderName: string;
  folders: { id: string; name: string }[];
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
// Shared OAuth app credentials per provider; one OAuth client serves many accounts.
type ZohoState = { clientId: string; clientSecret: string; dataCenter: string; oauthState: string; oauthStateExpiresAt: number };
type GmailState = { clientId: string; clientSecret: string; oauthState: string; oauthStateExpiresAt: number };
// One connected mailbox. `remoteId` is the Zoho mail account id (unused for Gmail).
export type MailAccount = {
  id: string;
  provider: 'zoho' | 'gmail';
  email: string;
  remoteId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  folders: ZohoFolder[];
};
export type AadOSState = { zoho: ZohoState; gmail: GmailState; accounts: MailAccount[]; pipelines: Pipeline[]; items: PipelineItem[] };

const emptyState = (): AadOSState => ({
  zoho: { clientId: '', clientSecret: '', dataCenter: 'com', oauthState: '', oauthStateExpiresAt: 0 },
  gmail: { clientId: '', clientSecret: '', oauthState: '', oauthStateExpiresAt: 0 },
  accounts: [],
  pipelines: [],
  items: []
});

export const accountId = (provider: string, email: string) => `${provider}-${email.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)}`;

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
  const saved = JSON.parse(clear) as Partial<AadOSState> & { zoho?: Record<string, any>; gmail?: Record<string, any> };
  const defaults = emptyState();
  const accounts: MailAccount[] = [...(saved.accounts || [])];
  // Migrate the old single Zoho/Gmail connection into the accounts list.
  if (!saved.accounts) {
    const z = saved.zoho, g = saved.gmail;
    if (z?.refreshToken && z.accountId) accounts.push({ id: accountId('zoho', z.connectedEmail || 'account'), provider: 'zoho', email: z.connectedEmail || '', remoteId: z.accountId, accessToken: z.accessToken || '', refreshToken: z.refreshToken, expiresAt: z.expiresAt || 0, folders: z.folders || [] });
    if (g?.refreshToken) accounts.push({ id: accountId('gmail', g.connectedEmail || 'account'), provider: 'gmail', email: g.connectedEmail || '', remoteId: '', accessToken: g.accessToken || '', refreshToken: g.refreshToken, expiresAt: g.expiresAt || 0, folders: g.folders || [] });
  }
  const firstAccount = (provider: string) => accounts.find((item) => item.provider === provider)?.id || '';
  return {
    ...defaults, ...saved,
    zoho: { clientId: saved.zoho?.clientId || '', clientSecret: saved.zoho?.clientSecret || '', dataCenter: saved.zoho?.dataCenter || 'com', oauthState: saved.zoho?.oauthState || '', oauthStateExpiresAt: saved.zoho?.oauthStateExpiresAt || 0 },
    gmail: { clientId: saved.gmail?.clientId || '', clientSecret: saved.gmail?.clientSecret || '', oauthState: saved.gmail?.oauthState || '', oauthStateExpiresAt: saved.gmail?.oauthStateExpiresAt || 0 },
    accounts,
    pipelines: (saved.pipelines || []).map((pipeline) => ({ ...pipeline, source: pipeline.source || 'zoho', accountId: pipeline.accountId || firstAccount(pipeline.source || 'zoho'), folders: pipeline.folders?.length ? pipeline.folders : [{ id: pipeline.folderId, name: pipeline.folderName }] }))
  } as AadOSState;
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
    configured: Boolean(state.zoho.clientId && state.zoho.clientSecret),
    dataCenter: state.zoho.dataCenter,
    gmailConfigured: Boolean(state.gmail.clientId && state.gmail.clientSecret),
    // Tokens never leave the server.
    accounts: state.accounts.map((account) => ({ id: account.id, provider: account.provider, email: account.email, folders: account.folders })),
    pipelines: state.pipelines,
    itemCounts: Object.fromEntries(state.pipelines.map((pipeline) => [pipeline.id, state.items.filter((item) => item.pipelineId === pipeline.id).length]))
  };
}
