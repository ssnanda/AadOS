import type { DigestState } from './ai/weekly-digest';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { PgStorage } from './pg-store.ts';
import { keyringFromEnv } from './vault.ts';
import { dirname, join } from 'node:path';
import { env } from '$env/dynamic/private';
import { dataDir } from './data-dir';

/** 'digest' = Weekly review: AI reads every email for the view's focus (see ai/weekly-digest.ts). */
export type PipelineParser = 'shop' | 'health' | 'generic' | 'digest';

/** `unread`: the provider's own unread count for the folder (Zoho folder list), refreshed by live sync. */
export type ZohoFolder = { id: string; name: string; path: string; type: string; unread?: number };
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
  /** Weekly review views: who/what to keep (e.g. "5th grade only"); empty = DEFAULT_FOCUS. */
  focus?: string;
  enabled: boolean;
  cursor: number;
  lastSync: string;
  lastError: string;
};

/** The original AAD folder view predates AI reviews; upgrade only that exact legacy view in place. */
const isLegacyAadView = (pipeline: Partial<Pipeline>) => !pipeline.system && pipeline.parser === 'generic' && (
  /^aad$/i.test(String(pipeline.name || '').trim()) ||
  /(^|[\/-])aad$/i.test(String(pipeline.folderName || '').trim()) ||
  /-aad$/i.test(String(pipeline.id || ''))
);
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
  /** Saved value from this email. Coupons require an expiry; gift cards intentionally do not expire. */
  savedValue?: { kind: 'coupon' | 'gift-card'; expiresOn?: string; savedAt: string };
  /** Prevent an automatically detected coupon from reappearing after the owner removes it. */
  savedValueDismissed?: boolean;
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
/** Retired local to-do (tasks now live in Asana). Type kept so stored records round-trip untouched. */
export type Task = {
  id: string; title: string; due: string; done: boolean; createdAt: string; emailKey?: string; priority?: 'high' | 'normal' | 'low'; completedAt?: string;
  notes?: string; /** HH:MM, local to prefs.timeZone */ dueTime?: string; tags?: string[]; /** Linked calendar occurrence: `${eventId}|${occurrenceStart}` */ eventKey?: string;
};
export type Prefs = { /** Calendar shown on the Conference Room tab */ roomCalendarId?: string; /** Asana: move new Incoming / Recently assigned tasks to To do automatically (default on) */ asanaAutoAck?: boolean; /** Home dashboard shows only Asana tasks that are due (today/overdue) */ asanaDashboardDueOnly?: boolean; /** IANA zone; '' = not set yet (UTC is used until the browser reports one) */ timeZone: string; /** minutes before an event; null = no automatic event reminders */ eventLeadMinutes: number | null; /** HH:MM reminder time for tasks without a due time; '' = none */ taskReminderTime: string; weekStart: 0 | 1 };
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
  /** Last unread check across every folder/label of the account (Emails page header). */
  unreadCheckedAt?: string;
  /** Gmail incremental-sync checkpoints (history cursor per label). */
  historyIds?: Record<string, string>;
  /** The account granted change access (Gmail gmail.modify / Zoho messages UPDATE+DELETE): delete to Trash, mark read/unread. */
  canModify?: boolean;
  /** May send mail the owner composes (Gmail via gmail.modify; Zoho messages CREATE). */
  canSend?: boolean;
  /** May manage Gmail filters (gmail.settings.basic). */
  canFilter?: boolean;
  /** Read-only calendar access was granted for this account (Google calendar.readonly / Zoho Calendar READ). */
  calendar?: boolean;
  /** May create/edit/delete events (Google calendar.events / Zoho ZohoCalendar.event.CREATE+UPDATE+DELETE). */
  calendarWrite?: boolean;
  /** Owner turned this account's calendars off (grant kept; nothing synced or shown). */
  calendarOff?: boolean;
  /** Google Contacts read access was granted (contacts.readonly). */
  contacts?: boolean;
  /** Owner turned this account's contacts off (grant kept). */
  contactsOff?: boolean;
  /** Family member who linked this account (only they see its mail and calendars); absent = the owner's. */
  ownerId?: string;
  calendarLastSync?: string;
  calendarError?: string;
  /** Email turned off for this account in Settings: its mail is not synced or shown (calendar is separate). */
  paused?: boolean;
};
// One page of a folder/label sync. `next` is the cursor for the following page ('' = done).
export type PageResult = { scanned: number; added: number; unknown: number; next: string; ids?: string[] };
// `dismissed` holds ids (pipelineId:messageId) of emails removed in AadOS, so syncs never bring them back.
/** Running Asana work timers by task gid (the time is logged to the task as a comment when stopped). */
export type AsanaTimer = { name: string; startedAt: string; note: string };
export type AadOSState = { /** Weekly review results per view id (cached per email). */ digests?: Record<string, DigestState>; /** Messages: address keys moved to Spam (never shown in the main view). */ messageSpam?: string[]; /** Messages: spam senders whose stop reply was delivered — shown under Spam reports, not Spam. */ messageSpamDone?: string[]; /** Messages sender groups: several numbers shown as one contact (e.g. "Atrium notifications"). */ messageGroups?: { id: string; name: string; addresses: string[] }[]; /** Canned replies for Messages (seeded with defaults on first use). */ messageTemplates?: { id: string; title: string; text: string }[]; asanaTimers?: Record<string, AsanaTimer>; /** iMessage chat guid → when it was last opened in AadOS (ms), for unread. */ messagesRead?: Record<string, number>; zoho: ZohoState; gmail: GmailState; accounts: MailAccount[]; pipelines: Pipeline[]; items: PipelineItem[]; dismissed: string[]; tasks: Task[]; calendars: CalendarInfo[]; events: CalEvent[]; calendarSync: Record<string, string>; calendarDisabled: string[]; reminders: Reminder[]; prefs: Prefs; ai: AiPrefs; aiStatus: AiStatus; notify: { browser: boolean }; integrations: Integrations; storageOk?: string };

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
  calendarSync: {},
  calendarDisabled: [],
  reminders: [],
  prefs: defaultPrefs(),
  ai: defaultAiPrefs(),
  aiStatus: defaultAiStatus(),
  notify: { browser: false },
  integrations: defaultIntegrations()
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
/** Retired feature (local reminders): records are kept as stored so existing state round-trips untouched. */
type Reminder = Record<string, unknown>;
/** AI is OFF until the owner enables it; nothing is sent to AJMCP before that. */
export type AiPrefs = { enabled: boolean; background: boolean; share: { email: boolean; calendar: boolean; documents: boolean; /** Finance facts — off until explicitly enabled */ finance: boolean }; emailBodies: boolean };
export type AiStatus = { lastOk: string; lastError: string; lastErrorAt: string; provider: string; model: string; gatewayVersion: string; checkedAt: string };
/** Integration settings edited in Settings. Stored with the other secrets (encrypted credential vault in PostgreSQL). */
export type Integrations = { ajmcp: { url: string; token: string }; asana: { token: string; workspaceGid: string; workspaceName: string; userName: string }; bluebubbles: { url: string; password: string; hookSecret: string }; etrade: EtradeConfig; plaid: PlaidConfig; s3: { endpoint: string; bucket: string; region: string; accessKey: string; secretKey: string; forcePathStyle: boolean; prefix: string } };
/** E*TRADE (read-only). Consumer key/secret per environment; OAuth 1.0a tokens expire at midnight US Eastern. */
export type EtradeConfig = { sandbox: boolean; consumerKey: string; consumerSecret: string; accessToken: string; accessSecret: string; requestToken: string; requestSecret: string; connectedAt: string; lastError: string; lastSyncedAt: string };
export const defaultEtrade = (): EtradeConfig => ({ sandbox: false, consumerKey: '', consumerSecret: '', accessToken: '', accessSecret: '', requestToken: '', requestSecret: '', connectedAt: '', lastError: '', lastSyncedAt: '' });
/** Plaid (investments, read-only). Each linked institution is an item with its own access token. */
export type PlaidItem = { id: string; itemId: string; accessToken: string; institutionId: string; institutionName: string; status: 'ok' | 'login_required'; lastError: string; lastSyncedAt: string; lastSyncSummary: string };
export type PlaidConfig = { env: 'sandbox' | 'production'; clientId: string; secret: string; redirectUri: string; items: PlaidItem[] };
export const defaultPlaid = (): PlaidConfig => ({ env: 'sandbox', clientId: '', secret: '', redirectUri: '', items: [] });
export const defaultIntegrations = (): Integrations => ({ ajmcp: { url: '', token: '' }, asana: { token: '', workspaceGid: '', workspaceName: '', userName: '' }, bluebubbles: { url: '', password: '', hookSecret: '' }, etrade: defaultEtrade(), plaid: defaultPlaid(), s3: { endpoint: '', bucket: '', region: '', accessKey: '', secretKey: '', forcePathStyle: true, prefix: '' } });
export const defaultAiPrefs = (): AiPrefs => ({ enabled: false, background: false, share: { email: true, calendar: true, documents: true, finance: false }, emailBodies: false });
export const defaultAiStatus = (): AiStatus => ({ lastOk: '', lastError: '', lastErrorAt: '', provider: '', model: '', gatewayVersion: '', checkedAt: '' });
export const defaultPrefs = (): Prefs => ({ timeZone: '', eventLeadMinutes: 15, taskReminderTime: '09:00', weekStart: 0 });

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
  return normalizeState(JSON.parse(clear));
}

/** Fill defaults and migrate older shapes; idempotent. Used for both storage backends. */
export function normalizeState(saved: Partial<AadOSState> & { zoho?: Record<string, any>; gmail?: Record<string, any> }): AadOSState {
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
    calendarDisabled: saved.calendarDisabled || [],
    reminders: saved.reminders || [],
    prefs: { ...defaultPrefs(), ...(saved.prefs || {}) },
    ai: { ...defaultAiPrefs(), ...(saved.ai || {}), share: { ...defaultAiPrefs().share, ...(saved.ai?.share || {}) } },
    aiStatus: { ...defaultAiStatus(), ...(saved.aiStatus || {}) },
    notify: { browser: false, ...(saved.notify || {}) },
    integrations: { ajmcp: { ...defaultIntegrations().ajmcp, ...(saved.integrations?.ajmcp || {}) }, asana: { ...defaultIntegrations().asana, ...(saved.integrations?.asana || {}) }, bluebubbles: { ...defaultIntegrations().bluebubbles, ...(saved.integrations?.bluebubbles || {}) }, etrade: { ...defaultEtrade(), ...(saved.integrations?.etrade || {}) }, plaid: { ...defaultPlaid(), ...(saved.integrations?.plaid || {}), items: saved.integrations?.plaid?.items || [] }, s3: { ...defaultIntegrations().s3, ...(saved.integrations?.s3 || {}) } },
    pipelines: (saved.pipelines || []).map((pipeline) => ({ ...pipeline, parser: isLegacyAadView(pipeline) ? 'digest' : pipeline.parser, source: pipeline.source || 'zoho', accountId: pipeline.accountId || firstAccount(pipeline.source || 'zoho'), folders: pipeline.folders?.length ? pipeline.folders : [{ id: pipeline.folderId, name: pipeline.folderName }] }))
  } as AadOSState;
}

let queue = Promise.resolve();

// ---- storage backends: `file` (encrypted state.enc, default) or `postgres` (AADOS_STORAGE=postgres) ----
const usePostgres = () => env.AADOS_STORAGE === 'postgres';
let pgPromise: Promise<PgStorage> | undefined;
let sharedPool: pg.Pool | undefined;
/** The one PostgreSQL pool of this process (state, AI and documents share it). */
function poolFor(url: string): pg.Pool { return (sharedPool ??= new pg.Pool({ connectionString: url, max: 8 })); }
/** For relational features (AI assistant, documents). Requires AADOS_STORAGE=postgres; waits for migrations. */
export async function database(): Promise<pg.Pool> {
  if (!usePostgres() || !env.AADOS_DATABASE_URL) throw new Error('This feature needs PostgreSQL storage (AADOS_STORAGE=postgres).');
  await postgres();
  return poolFor(env.AADOS_DATABASE_URL);
}
export const hasDatabase = () => usePostgres() && Boolean(env.AADOS_DATABASE_URL);

/** Connect, wait for the API's migrations, and import state.enc once (backup first, integrity-checked, original kept). */
function postgres(): Promise<PgStorage> {
  pgPromise ??= (async () => {
    if (!env.AADOS_DATABASE_URL) throw new Error('AADOS_DATABASE_URL is required when AADOS_STORAGE=postgres');
    const storage = new PgStorage(poolFor(env.AADOS_DATABASE_URL), keyringFromEnv(env), normalizeState);
    await storage.ready();
    await importLegacyFile(storage);
    return storage;
  })().catch((error) => { pgPromise = undefined; throw error; });
  return pgPromise;
}

async function importLegacyFile(storage: PgStorage) {
  const file = stateFile();
  let raw: string;
  try { raw = await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (await storage.load()) return; // PostgreSQL already holds state: never overwrite it from the file
  const backup = `${file}.pre-postgres-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await copyFile(file, backup);
  await chmod(backup, 0o600);
  const result = await storage.importState(decrypt(raw), 'state.enc');
  console.log(`[aados] imported state.enc into PostgreSQL (${JSON.stringify(result.counts)}); original kept at ${file}, backup at ${backup}`);
}

/** Best-effort: ask the API to rebuild its relational mirror (search/summary) from the primary state. */
export async function refreshMirror(): Promise<void> {
  if (!env.AADOS_API_URL || !env.AADOS_INTERNAL_API_TOKEN) return;
  try {
    const res = await fetch(`${env.AADOS_API_URL.replace(/\/$/, '')}/internal/v1/mirror/refresh`, { method: 'POST', headers: { Authorization: `Bearer ${env.AADOS_INTERNAL_API_TOKEN}` }, signal: AbortSignal.timeout(60_000) });
    console.log(`[aados] mirror refresh: HTTP ${res.status}`);
  } catch (error) { console.warn('[aados] mirror refresh failed:', error instanceof Error ? error.message : error); }
}

/** Call once at server start: connects, waits for migrations and imports state.enc, so problems surface in the logs immediately. */
export function initStorage(): void {
  if (usePostgres()) postgres().then(() => { console.log('[aados] storage: PostgreSQL (primary)'); void refreshMirror(); }, (error) => console.error('[aados] storage init failed:', error instanceof Error ? error.message : error));
  else console.log('[aados] storage: encrypted file');
}

export async function readState(): Promise<AadOSState> {
  if (usePostgres()) return (await (await postgres()).load()) ?? emptyState();
  try { return decrypt(await readFile(stateFile(), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    throw error;
  }
}

export async function updateState(change: (state: AadOSState) => void | Promise<void>): Promise<AadOSState> {
  let result = emptyState();
  queue = queue.catch(() => undefined).then(async () => {
    if (usePostgres()) { result = await (await postgres()).transact(change, emptyState); return; }
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
  // Items without a recorded folder count as this folder's only if it IS the view's single folder (not an extra folder
  // synced into the view, e.g. a Zoho subfolder pulled into the inbox feed).
  const single = pipelineFolders(pipeline).filter((folder) => folder.accountId === account).length <= 1 && pipelineFolders(pipeline).some((f) => f.id === folderId);
  for (const item of state.items) {
    if (item.pipelineId !== pipeline.id || (item.accountId || pipeline.accountId) !== account) continue;
    if (unreadIds.has(item.messageId)) { item.unread = true; item.folderId ||= folderId; }
    else if (item.folderId === folderId || (!item.folderId && single)) item.unread = false;
  }
  // Copies of the same message in other views follow the mailbox too (they may not have been refreshed).
  const decided = new Map<string, boolean>();
  for (const item of state.items) if (item.pipelineId === pipeline.id && (item.accountId || pipeline.accountId) === account && (unreadIds.has(item.messageId) || item.folderId === folderId)) decided.set(item.messageId, item.unread !== false);
  const owner = new Map(state.pipelines.map((p) => [p.id, p.accountId]));
  for (const item of state.items) if (item.pipelineId !== pipeline.id && decided.has(item.messageId) && (item.accountId || owner.get(item.pipelineId)) === account) item.unread = decided.get(item.messageId);
}

/** Stored copies of one view's folder (same folder rule as `applyUnread`). */
const folderItems = (state: AadOSState, pipeline: Pipeline, folderId: string, account: string) => {
  const single = pipelineFolders(pipeline).filter((folder) => folder.accountId === account).length <= 1 && pipelineFolders(pipeline).some((f) => f.id === folderId);
  return state.items.filter((item) => item.pipelineId === pipeline.id && (item.accountId || pipeline.accountId) === account && (item.folderId === folderId || (!item.folderId && single)));
};

/** Drop stored copies that left the folder in the mailbox (deleted, trashed or moved, e.g. on the phone). */
export function removeFromFolder(state: AadOSState, pipeline: Pipeline, folderId: string, messageIds: Set<string>, account: string): number {
  if (!messageIds.size) return 0;
  const gone = new Set(folderItems(state, pipeline, folderId, account).filter((item) => messageIds.has(item.messageId)).map((item) => item.id));
  if (gone.size) state.items = state.items.filter((item) => !gone.has(item.id));
  return gone.size;
}

/**
 * `listedIds` is the folder's newest page as the mailbox lists it now. Stored copies newer than the
 * oldest listed one that are missing from it have left the folder. `complete` = the page is the whole
 * folder. An empty listing never removes anything (an API hiccup must not wipe a folder).
 */
export function pruneFolderWindow(state: AadOSState, pipeline: Pipeline, folderId: string, account: string, listedIds: string[], complete: boolean): number {
  if (!listedIds.length) return 0;
  const listed = new Set(listedIds);
  const mine = folderItems(state, pipeline, folderId, account);
  const boundary = complete ? '' : mine.filter((item) => listed.has(item.messageId)).map((item) => item.receivedAt).sort()[0];
  if (!complete && !boundary) return 0;
  const gone = new Set(mine.filter((item) => !listed.has(item.messageId) && (complete || item.receivedAt > boundary!)).map((item) => item.messageId));
  return removeFromFolder(state, pipeline, folderId, gone, account);
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
    accounts: state.accounts.map((account) => ({ id: account.id, provider: account.provider, email: account.email, folders: account.folders, lastSync: account.lastSync || '', lastError: account.lastError || '', paused: Boolean(account.paused), canModify: Boolean(account.canModify), canSend: Boolean(account.canSend), canFilter: Boolean(account.canFilter), calendar: Boolean(account.calendar), calendarWrite: Boolean(account.calendarWrite), calendarOff: Boolean(account.calendarOff), contacts: Boolean(account.contacts), contactsOff: Boolean(account.contactsOff), ownerId: account.ownerId || '', calendarLastSync: account.calendarLastSync || '', calendarError: account.calendarError || '', messages: state.items.filter((item) => (item.accountId || state.pipelines.find((p) => p.id === item.pipelineId)?.accountId) === account.id).length })),
    pipelines: visiblePipelines(state),
    itemCounts: Object.fromEntries(visiblePipelines(state).map((pipeline) => [pipeline.id, state.items.filter((item) => item.pipelineId === pipeline.id).length]))
  };
}
