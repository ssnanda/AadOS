// The unified inbox list and the "mark" action, shared by the /emails page and the mobile app API
// (/api/mobile/emails), so both always show the same rows and change mail the same way.
import type { SessionUser } from './auth';
import { applyToMailbox } from './mail-actions';
import { keyAllowed, scopeState } from './scope';
import { database, ensureInboxPipelines, hasDatabase, missingInboxPipelines, readState, updateState, visiblePipelines, type AadOSState } from './aados-store';
import { getInsights } from './ai/db';
import { bodyMatches } from './body-index';
import { recordUndo } from './mail-undo';
import { buildRows, folderSummary, queryInbox, type InboxQuery, type InboxRow, type InboxView } from './inbox';
import { CATEGORIES } from './categories';
import { isUnread } from './search';
import { aiConfigured } from './ai/service';
import { kindMeta } from '../kinds';

/** One Shopping tile: `key` is `saved:<coupon|gift-card>` or `kind:<parsed kind>`; picking it lists those emails. */
export type ShopTile = { key: string; label: string; icon: string; tone: string; count: number; detail: string };

// Tabs: unread, recent, smart views, all. Older views (important, needs-reply, inbox, read) still work for existing links.
const VIEWS: InboxView[] = ['unread', 'recent', 'leads', 'scans', 'rent', 'attention', 'people', 'bills', 'bulk', 'all', 'inbox', 'important', 'needs-reply', 'read'];

/** URL parameters → inbox query (unknown values fall back to the defaults). */
export function parseInboxQuery(p: URLSearchParams, pageSize = 50): InboxQuery {
  const view = (VIEWS as string[]).includes(p.get('view') || '') ? (p.get('view') as InboxView) : 'unread';
  return {
    view, account: p.get('account') || '', provider: p.get('provider') || '', sender: p.get('sender') || '', from: p.get('from') || '', to: p.get('to') || '',
    read: p.get('read') === 'read' ? 'read' : p.get('read') === 'unread' ? 'unread' : '', category: (CATEGORIES as readonly string[]).includes(p.get('category') || '') ? p.get('category')! : '',
    pipeline: p.get('pipeline') || '', thread: p.get('thread') || '', folder: p.get('folder') || '', kind: p.get('kind') || '',
    saved: p.get('saved') === 'coupon' ? 'coupon' : p.get('saved') === 'gift-card' ? 'gift-card' : '', q: (p.get('q') || '').trim(), page: Number(p.get('page')) || 1, pageSize
  };
}

/** Per-account folders with unread counts (the sidebar's Emails sub-menu; the app's folder drawer). */
export function accountFolders(state: AadOSState) {
  const ownerOf = new Map(state.pipelines.map((p) => [p.id, p.accountId]));
  const unreadKeys = new Map<string, Set<string>>();
  for (const i of state.items) if (isUnread(i)) { const a = i.accountId || ownerOf.get(i.pipelineId) || ''; let set = unreadKeys.get(a); if (!set) unreadKeys.set(a, (set = new Set())); set.add(i.messageId); }
  const folders = folderSummary(state);
  // Every folder/label of the account (not only ones with stored mail): stored counts, or the provider's unread count when higher.
  const SKIP = /^(trash|spam|junk|drafts|outbox|templates)$/i;
  return state.accounts.filter((a) => !a.paused).map((a) => {
    const stored = new Map((folders[a.id] || []).map((f) => [f.id, f]));
    const list = (a.folders || []).filter((f) => !SKIP.test(f.type || '') && !SKIP.test(f.name)).map((f) => { const s = stored.get(f.id); return { id: f.id, name: f.path && f.path !== '/' ? f.path.replace(/^\//, '') : f.name, total: s?.total || 0, unread: Math.max(s?.unread || 0, f.unread || 0) }; });
    for (const s of stored.values()) if (!list.some((f) => f.id === s.id)) list.push(s);
    list.sort((x, y) => (x.name.toLowerCase() === 'inbox' ? -1 : y.name.toLowerCase() === 'inbox' ? 1 : x.name.localeCompare(y.name)));
    return { id: a.id, provider: a.provider, email: a.email || a.id, unread: unreadKeys.get(a.id)?.size || 0, folders: list };
  });
}

/** Everything the inbox screen shows for one query, limited to what `user` may see. */
export async function emailList(params: URLSearchParams, user: SessionUser | null, opts: { pageSize?: number; folders?: boolean } = {}) {
  let state = await readState();
  // First visit after connecting an account: create the hidden per-account inbox feeds (never touches existing data).
  if (missingInboxPipelines(state)) { await updateState((s) => { ensureInboxPipelines(s); }); state = await readState(); }
  state = scopeState(state, user);
  const query = parseInboxQuery(params, opts.pageSize ?? 50);
  const rows = buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items });
  // Shopping views are tiles only (no unread/all switch): every email counts, and the list appears once a tile or a search is picked.
  const shopView = state.pipelines.find((p) => p.id === query.pipeline && p.parser === 'shop');
  if (shopView) query.view = 'all';
  const shop = shopView ? { tiles: shopTiles(rows, shopView.id) } : null;
  // Searches also match email body text (PostgreSQL full-text index; empty when not available).
  const bodyHits = query.q ? await bodyMatches(query.q) : undefined;
  const result = queryInbox(rows, query, undefined, bodyHits, state.tabRules);
  if (shopView && !query.kind && !query.saved && !query.q) Object.assign(result, { rows: [], total: 0, page: 1, pages: 1 });
  const saved = {
    coupons: rows.filter((r) => r.savedKind === 'coupon').sort((a, b) => (a.savedExpiry || '9999').localeCompare(b.savedExpiry || '9999')).map((r) => ({ key: r.key, subject: r.subject, sender: r.sender, expiresOn: r.savedExpiry })),
    giftCards: rows.filter((r) => r.savedKind === 'gift-card').sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).map((r) => ({ key: r.key, subject: r.subject, sender: r.sender }))
  };
  // Cached AI insights for the visible rows only (never computed here).
  const insights: Record<string, { summary: string; category: string; confidence: number; needsReply: boolean; paymentDue: string | null }> = {};
  if (hasDatabase()) for (const [k, v] of await getInsights(await database(), result.rows.map((r) => r.key)).catch(() => new Map())) if (v.status === 'done' && v.insight) insights[k] = { summary: v.insight.summary, category: v.insight.category, confidence: v.insight.confidence, needsReply: v.insight.needsReply, paymentDue: v.insight.paymentDue };
  const folderName = query.folder ? (folderSummary(state)[query.account || '']?.find((f) => f.id === query.folder)?.name || query.folder) : '';
  return {
    folderName, insights, aiAvailable: hasDatabase(),
    // Why AI replies are unavailable ('' = ready); the Reply menu shows this instead of hiding the options.
    aiBlocked: !aiConfigured(state) ? 'Connect the AJMCP gateway in Settings → AI' : !state.ai.enabled ? 'Turn on AI in Settings → AI' : !state.ai.share.email ? 'Allow Email in Settings → AI' : !hasDatabase() ? 'AI drafts need PostgreSQL storage' : '',
    query, ...result, saved, shop,
    categories: CATEGORIES,
    accounts: state.accounts.map((a) => ({ id: a.id, provider: a.provider, email: a.email || a.id, lastSync: a.lastSync || '', lastError: a.lastError || '', unreadCheckedAt: a.unreadCheckedAt || '', paused: Boolean(a.paused), total: rows.filter((r) => r.accountId === a.id).length, unread: rows.filter((r) => r.accountId === a.id && r.unread).length })),
    views: visiblePipelines(state).map((v) => ({ id: v.id, name: v.name, parser: v.parser, total: state.items.filter((i) => i.pipelineId === v.id).length, unread: state.items.filter((i) => i.pipelineId === v.id && isUnread(i)).length })),
    // The web page gets these from the layout; the app asks for them here (one state read).
    folders: opts.folders ? accountFolders(state) : undefined
  };
}

/** Shopping tiles over one view's emails: saved Coupons and Gift Cards always, then each parsed kind present. */
function shopTiles(rows: InboxRow[], pipelineId: string): ShopTile[] {
  const inView = rows.filter((r) => r.copyIds.some((id) => id.startsWith(`${pipelineId}:`)));
  const coupons = inView.filter((r) => r.savedKind === 'coupon').map((r) => r.savedExpiry).filter(Boolean).sort();
  const gifts = inView.filter((r) => r.savedKind === 'gift-card').length;
  const kinds = new Map<string, number>();
  for (const r of inView) { const k = r.kinds.find((x) => x.startsWith(`${pipelineId}:`))?.slice(pipelineId.length + 1); if (k) kinds.set(k, (kinds.get(k) || 0) + 1); }
  return [
    { key: 'saved:coupon', label: 'Coupons', icon: '🎟', tone: 'amber', count: coupons.length, detail: coupons.length ? `Next expires ${coupons[0]}` : 'None saved' },
    { key: 'saved:gift-card', label: 'Gift Cards', icon: '🎁', tone: 'amber', count: gifts, detail: gifts ? 'No expiry' : 'None saved' },
    ...[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => { const m = kindMeta(k); return { key: `kind:${k}`, label: m.label, icon: m.icon, tone: m.tone, count: n, detail: '' }; })
  ];
}

const account = (state: AadOSState, item: { pipelineId: string; accountId?: string }) => item.accountId || state.pipelines.find((p) => p.id === item.pipelineId)?.accountId || '';

export type MarkResult = { ok: true; marked: string[]; warning?: string } | { ok: false; error: string };

/**
 * Delete (to the provider's Trash) and read/unread are changed in Gmail/Zoho first; AadOS follows only where that worked.
 * The other ops are AadOS-only review state for the message (all its copies); the mailbox is never modified for them.
 */
/** `record: false` skips the undo log (used by Undo itself). */
export async function markEmails(user: SessionUser | null, rawKeys: string[], op: string, value = '', opts: { record?: boolean } = {}): Promise<MarkResult> {
  const keys = rawKeys.map(String).filter((k) => k && keyAllowed(user, k));
  let errors: string[] = [];
  let applyKeys = keys;
  let tokens: Awaited<ReturnType<typeof applyToMailbox>>['tokens'] = [];
  if (op === 'delete' || op === 'mark-read' || op === 'mark-unread') {
    if (!keys.length) return { ok: false, error: 'Choose at least one email.' };
    const r = await applyToMailbox(op, keys);
    errors = r.errors; applyKeys = r.done; tokens = r.tokens;
    if (!applyKeys.length) return { ok: false, error: errors.join(' ') || 'Nothing was changed.' };
  }
  try {
    // One save: the change itself plus any token refreshed during the mailbox calls.
    await updateState((state) => {
      for (const t of tokens) { const a = state.accounts.find((x) => x.id === t.id); if (a) { a.accessToken = t.accessToken; a.expiresAt = t.expiresAt; } }
      const wanted = new Set(applyKeys);
      const copies = state.items.filter((item) => wanted.has(`${account(state, item)}:${item.messageId}`));
      if (!keys.length || !copies.length) throw new Error('Choose at least one email.');
      // Undo log: deletes, and read/unread changes that actually flipped something.
      if (opts.record !== false && (op === 'delete' || op === 'mark-read' || op === 'mark-unread')) {
        const flipped = op === 'delete' ? copies : copies.filter((c) => (op === 'mark-read' ? isUnread(c) : !isUnread(c)));
        recordUndo(state, op, [...new Set(flipped.map((c) => `${account(state, c)}:${c.messageId}`))], flipped);
      }
      // Keep the sidebar's per-folder unread counts (the provider's count, refreshed by the unread scan) in step right away.
      if (op === 'delete' || op === 'mark-read' || op === 'mark-unread') {
        const delta = op === 'mark-unread' ? 1 : -1, seen = new Set<string>();
        for (const item of copies) {
          const k = `${account(state, item)}:${item.messageId}`;
          if (seen.has(k) || !item.folderId || (op === 'mark-unread' ? isUnread(item) : !isUnread(item))) continue;
          seen.add(k);
          const acct = state.accounts.find((a) => a.id === account(state, item));
          const f = acct?.folders?.find((x) => x.id === item.folderId);
          if (f && typeof f.unread === 'number') f.unread = Math.max(0, f.unread + delta);
        }
      }
      if (op === 'delete') {
        const gone = new Set(copies.map((item) => item.id));
        state.items = state.items.filter((item) => !gone.has(item.id));
        state.dismissed.push(...[...gone].filter((id) => !state.dismissed.includes(id)));
        return;
      }
      for (const item of copies) {
        if (op === 'mark-read') { item.seen = true; item.unread = false; }
        else if (op === 'mark-unread') { item.seen = false; item.unread = true; globalThis.__aadosSeen?.delete(`${item.pipelineId}\u0000${item.messageId}`); }
        else if (op === 'actionable' || op === 'dismissed' || op === 'reviewed') item.actionState = op;
        else if (op === 'clear-action') delete item.actionState;
        else if (op === 'follow-up') item.followUp = item.followUp || new Date().toISOString();
        else if (op === 'clear-follow-up') delete item.followUp;
        else if (op === 'importance-high' || op === 'importance-normal') item.importance = op === 'importance-high' ? 'high' : 'normal';
        else if (op === 'clear-importance') delete item.importance;
        else if (op === 'save-coupon') {
          // Expiry is optional (rules and quick saves have none): '' = no expiry.
          if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`)))) throw new Error('Choose a valid coupon expiry date.');
          item.savedValue = { kind: 'coupon', ...(value ? { expiresOn: value } : {}), savedAt: new Date().toISOString() };
          delete item.savedValueDismissed;
        }
        else if (op === 'save-gift-card') { item.savedValue = { kind: 'gift-card', savedAt: new Date().toISOString() }; delete item.savedValueDismissed; }
        else if (op === 'clear-saved-value') { delete item.savedValue; item.savedValueDismissed = true; }
        else if (op === 'categories') { const list = value.split(',').filter((c) => (CATEGORIES as readonly string[]).includes(c)); if (list.length) item.categories = list; else delete item.categories; }
        else throw new Error('Unknown action.');
      }
    });
  } catch (cause) { return { ok: false, error: cause instanceof Error ? cause.message : 'Update failed.' }; }
  return errors.length ? { ok: true, marked: applyKeys, warning: errors.join(' ') } : { ok: true, marked: applyKeys };
}
