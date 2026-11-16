import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from '$env/dynamic/private';
import { dataDir } from './data-dir';

export type PipelineParser = 'shop' | 'health' | 'generic';

export type ZohoFolder = { id: string; name: string; path: string; type: string };
export type Pipeline = {
  id: string;
  name: string;
  source: 'zoho' | 'gmail';
  accountId: string;
  folderId: string;
  folderName: string;
  /** Each folder may live in a different account (a view can span accounts); missing = the view's own account/source. */
  folders: { id: string; name: string; accountId?: string; source?: 'zoho' | 'gmail' }[];
  /** Hidden per-account inbox feed that powers the unified inbox; not shown as a view. */
  system?: boolean;
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
  /** Mailbox read state at last sync; undefined = not recorded yet (counts as unread). */
  unread?: boolean;
  /** Opened in AadOS — local only (mailbox access is read-only), so a later sync can't flip it back. */
  seen?: boolean;
  /** Provider conversation id (Gmail threadId) when known. */
  threadId?: string;
  /** Local-only overrides; the mailbox is never modified. */
  categories?: string[];
  importance?: 'high' | 'normal';
  actionState?: 'actionable' | 'dismissed' | 'reviewed';
  /** ISO time a local follow-up was created for this message. */
  followUp?: string;
  /** Mailbox the message came from (views can span accounts); missing = the view's account. */
  accountId?: string;
  /** Zoho folder holding the message (needed to fetch its body). */
  folderId?: string;
  facts: Record<string, string | number | boolean>;
};
// Shared OAuth app credentials per provider; one OAuth client serves many accounts.
type ZohoState = { clientId: string; clientSecret: string; dataCenter: string; oauthState: string; oauthStateExpiresAt: number; pending?: PendingFlows };
type GmailState = { clientId: string; clientSecret: string; oauthState: string; oauthStateExpiresAt: number; pkceVerifier?: string; pending?: PendingFlows };
/** Local to-do / reminder. `emailKey` links it to a source message (accountId:messageId). */
export type Task = { id: string; title: string; due: string; done: boolean; createdAt: string; emailKey?: string; priority?: 'high' | 'normal' | 'low'; completedAt?: string };
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
  /** Connection health, updated by syncs. */
  lastSync?: string;
  lastError?: string;
  /** Gmail incremental-sync checkpoints (history cursor per label). */
  historyIds?: Record<string, string>;
  /** Excluded from the scheduled sync (manual sync still works). */
  paused?: boolean;
};
// One page of a folder/label sync. `next` is the cursor for the following page ('' = done).
export type PageResult = { scanned: number; added: number; unknown: number; next: string };
// `dismissed` holds ids (pipelineId:messageId) of emails removed in AadOS, so syncs never bring them back.
export type AadOSState = { zoho: ZohoState; gmail: GmailState; accounts: MailAccount[]; pipelines: Pipeline[]; items: PipelineItem[]; dismissed: string[]; tasks: Task[]; calendars: CalendarInfo[]; events: CalEvent[]; calendarSync: Record<string, string> };

const emptyState = (): AadOSState => ({
  zoho: { clientId: '', clientSecret: '', dataCenter: 'com', oauthState: '', oauthStateExpiresAt: 0 },
  gmail: { clientId: '', clientSecret: '', oauthState: '', oauthStateExpiresAt: 0 },
  accounts: [],
  pipelines: [],
  items: [],
  dismissed: [],
  tasks: [],
  calendars: [],
  events: [],
  calendarSync: {}
});

/** A view's folders, each resolved to its own account and provider. */
export const pipelineFolders = (pipeline: Pipeline) => (pipeline.folders?.length ? pipeline.folders : [{ id: pipeline.folderId, name: pipeline.folderName }])
  .map((folder) => ({ ...folder, accountId: folder.accountId || pipeline.accountId, source: (folder.source || pipeline.source) as 'zoho' | 'gmail' }));
/** True if at least one of the view's accounts is still connected. */
export const hasAccount = (state: AadOSState, pipeline: Pipeline) => pipelineFolders(pipeline).some((folder) => state.accounts.some((account) => account.id === folder.accountId));

export { validOAuthState } from './oauth-state.ts';
import { mergeSync } from './sync-merge.ts';
import type { PendingFlows } from './oauth-state.ts';
import type { CalEvent, CalendarInfo } from '../calendar/model.ts';

export const accountId = (provider: string, email: string) => `${provider}-${email.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)}`;

const stateFile = () => join(dataDir(), 'state.enc');
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
    zoho: { clientId: saved.zoho?.clientId || '', clientSecret: saved.zoho?.clientSecret || '', dataCenter: saved.zoho?.dataCenter || 'com', oauthState: '', oauthStateExpiresAt: 0, pending: saved.zoho?.pending || {} },
    gmail: { clientId: saved.gmail?.clientId || '', clientSecret: saved.gmail?.clientSecret || '', oauthState: saved.gmail?.oauthState || '', oauthStateExpiresAt: saved.gmail?.oauthStateExpiresAt || 0, pkceVerifier: '', pending: saved.gmail?.pending || {} },
    accounts,
    dismissed: saved.dismissed || [],
    tasks: saved.tasks || [],
    calendars: saved.calendars || [],
    events: saved.events || [],
    calendarSync: saved.calendarSync || {},
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

/**
 * Run a long, network-bound change (a sync) on a private snapshot so other writes are not blocked,
 * then merge only its effects into the latest state inside one short locked update.
 * If `work` throws, partial results that were produced are still merged (so progress survives), then the error is rethrown.
 */
export async function updateStateDetached(work: (snapshot: AadOSState) => Promise<void>): Promise<void> {
  const before = await readState();
  const working = structuredClone(before);
  let failure: unknown;
  try { await work(working); } catch (cause) { failure = cause; }
  await updateState((latest) => mergeSync(latest, before, working));
  if (failure) throw failure;
}

/** Message ids of a view that are already stored or were dismissed. */
export function knownMessageIds(state: AadOSState, pipelineId: string): Set<string> {
  const known = new Set(state.items.filter((item) => item.pipelineId === pipelineId).map((item) => item.messageId));
  const prefix = `${pipelineId}:`;
  for (const id of state.dismissed) if (id.startsWith(prefix)) known.add(id.slice(prefix.length));
  return known;
}

/**
 * Make read state match the mailbox: items of the folder in `unreadIds` become unread, the rest read.
 * Items with no recorded folder are only reset when the view has a single folder (else only flagged unread).
 */
export function applyUnread(state: AadOSState, pipeline: Pipeline, folderId: string, unreadIds: Set<string>, account: string) {
  const single = pipelineFolders(pipeline).filter((folder) => folder.accountId === account).length <= 1;
  for (const item of state.items) {
    if (item.pipelineId !== pipeline.id || (item.accountId || pipeline.accountId) !== account) continue;
    if (unreadIds.has(item.messageId)) { item.unread = true; item.folderId ||= folderId; }
    else if (item.folderId === folderId || (!item.folderId && single)) item.unread = false;
  }
}

/** Inbox folder of an account (Gmail INBOX label, Zoho Inbox folder), if discovered. */
const inboxFolder = (account: MailAccount) => account.provider === 'gmail'
  ? { id: 'INBOX', name: 'Inbox' }
  : account.folders.find((folder) => /^inbox$/i.test(folder.type) || /^\/?inbox$/i.test(folder.path || folder.name));

export const missingInboxPipelines = (state: AadOSState) => state.accounts.some((account) => inboxFolder(account) && !state.pipelines.some((item) => item.id === `inbox-${account.id}`));

/**
 * Give every account a hidden "Inbox" feed so the unified inbox works without creating views.
 * Idempotent; returns true when something was added.
 */
export function ensureInboxPipelines(state: AadOSState): boolean {
  let changed = false;
  for (const account of state.accounts) {
    const id = `inbox-${account.id}`;
    const folder = inboxFolder(account);
    if (!folder || state.pipelines.some((item) => item.id === id)) continue;
    state.pipelines.push({ id, name: 'Inbox', source: account.provider, accountId: account.id, folderId: folder.id, folderName: 'Inbox', folders: [{ id: folder.id, name: 'Inbox', accountId: account.id, source: account.provider }], system: true, parser: 'generic', enabled: true, cursor: 0, lastSync: '', lastError: '' });
    changed = true;
  }
  return changed;
}

export const visiblePipelines = (state: AadOSState) => state.pipelines.filter((pipeline) => !pipeline.system);

export function publicState(state: AadOSState) {
  return {
    configured: Boolean(state.zoho.clientId && state.zoho.clientSecret),
    dataCenter: state.zoho.dataCenter,
    gmailConfigured: Boolean(state.gmail.clientId && state.gmail.clientSecret),
    // Tokens never leave the server.
    accounts: state.accounts.map((account) => ({ id: account.id, provider: account.provider, email: account.email, folders: account.folders, lastSync: account.lastSync || '', lastError: account.lastError || '', paused: Boolean(account.paused), messages: state.items.filter((item) => (item.accountId || state.pipelines.find((p) => p.id === item.pipelineId)?.accountId) === account.id).length })),
    pipelines: visiblePipelines(state),
    itemCounts: Object.fromEntries(visiblePipelines(state).map((pipeline) => [pipeline.id, state.items.filter((item) => item.pipelineId === pipeline.id).length]))
  };
}
