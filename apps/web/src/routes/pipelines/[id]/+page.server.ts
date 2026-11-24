import { scopeState } from '$lib/server/scope';
import { error, fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasDatabase, readState, updateState } from '$lib/server/aados-store';
import { clean, parseMessage } from '$lib/server/pipeline-parser';
import { filterItems } from '$lib/server/search';
import { digestView, markDigestItem, runDigest } from '$lib/server/ai/weekly-digest-service';
import { buildRows, messageKey } from '$lib/server/inbox';
import type { AadOSState, Pipeline } from '$lib/server/aados-store';
import { aiConfigured } from '$lib/server/ai/service';

const PAGE = 50;
const count = (values: string[]) => {
  const map = new Map<string, number>();
  for (const value of values) if (value) map.set(value, (map.get(value) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};

type Saved = 'coupon' | 'gift-card' | '';
const savedParam = (value: unknown): Saved => (value === 'coupon' || value === 'gift-card' ? value : '');
/** Shopping: message keys of this view's emails with a saved coupon (soonest expiry first) or gift card. */
function savedOf(state: AadOSState, pipeline: Pipeline) {
  const rows = pipeline.parser !== 'shop' ? [] : buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items })
    .filter((r) => r.savedKind && r.copyIds.some((id) => id.startsWith(`${pipeline.id}:`)));
  const coupons = rows.filter((r) => r.savedKind === 'coupon').sort((a, b) => a.savedExpiry.localeCompare(b.savedExpiry));
  return { coupon: coupons.map((r) => r.key), 'gift-card': rows.filter((r) => r.savedKind === 'gift-card').map((r) => r.key), nextExpiry: coupons[0]?.savedExpiry || '' };
}
const keyOf = (item: { accountId?: string; messageId: string }, pipeline: Pipeline) => messageKey(item.accountId || pipeline.accountId, item.messageId);

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const state = scopeState(await readState(), locals.user);
  const pipeline = state.pipelines.find((item) => item.id === params.id);
  if (!pipeline) throw error(404, 'Pipeline not found');
  const all = state.items.filter((item) => item.pipelineId === pipeline.id);
  const kind = url.searchParams.get('kind') || '';
  const store = url.searchParams.get('store') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const saved = savedParam(url.searchParams.get('saved'));
  const savedKeys = savedOf(state, pipeline);
  // Views are about every email in them (no read/unread switch). The page opens on the view's own tiles (Shopping:
  // categories + stores); the email list loads only once a tile, a store or a search is picked, or "Show all" (paged).
  const showAll = url.searchParams.get('show') === 'all';
  const listing = Boolean(kind || store || q || showAll || saved);
  const pages = Math.min(Math.max(Number(url.searchParams.get('pages')) || 1, 1), 40);
  const searched = filterItems(all, { q });
  const savedOrder = saved ? savedKeys[saved] : [];
  const shown = !listing ? [] : saved
    ? filterItems(searched, { store }).filter((item) => savedOrder.includes(keyOf(item, pipeline))).sort((a, b) => savedOrder.indexOf(keyOf(a, pipeline)) - savedOrder.indexOf(keyOf(b, pipeline)))
    : filterItems(searched, { kind, store }).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return {
    pipeline,
    total: all.length,
    searched: searched.length,
    kinds: count(searched.map((item) => item.kind)),
    stores: count(searched.map((item) => String(item.facts.store || ''))).slice(0, 14),
    kind, store, q, showAll, listing, saved,
    // Shopping's saved-value tiles (always shown for Shopping views).
    savedTiles: pipeline.parser === 'shop' ? { coupon: savedKeys.coupon.length, giftCard: savedKeys['gift-card'].length, nextExpiry: savedKeys.nextExpiry } : null, pages, pageSize: PAGE,
    aiAvailable: hasDatabase(),
    aiBlocked: !aiConfigured(state) ? 'Connect the AJMCP gateway in Settings → AI' : !state.ai.enabled ? 'Turn on AI in Settings → AI' : !state.ai.share.email ? 'Allow Email in Settings → AI' : !hasDatabase() ? 'AI drafts need PostgreSQL storage' : '',
    matched: shown.length,
    items: shown.slice(0, pages * PAGE).map((item) => {
      const accountId = item.accountId || pipeline.accountId;
      return { ...item, accountId, key: messageKey(accountId, item.messageId) };
    }),
    // Weekly review views: AI review of the last 7 days + tutoring session trends.
    review: pipeline.parser === 'digest' ? digestView(state, pipeline) : null
  };
};

export const actions: Actions = {
  // Weekly review: start in the background (the page polls progress); only new/changed emails are read.
  review: async ({ params }) => { void runDigest(params.id ?? ''); return { reviewing: true }; },
  reviewMark: async ({ params, request }) => {
    const f = await request.formData(), op = String(f.get('op') || '') as 'done' | 'dismissed' | 'clear' | 'task';
    if (!['done', 'dismissed', 'clear', 'task'].includes(op)) return fail(400, { error: 'Unknown action.' });
    try { const task = await markDigestItem(params.id ?? '', String(f.get('item') || ''), op); return { marked: op, task }; }
    catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Update failed.' }); }
  },
  // Re-run the parser over stored fields (subject, sender, summary) without re-syncing.
  reparse: async ({ params }) => {
    let changed = 0;
    try {
      await updateState((state) => {
        const pipeline = state.pipelines.find((item) => item.id === params.id);
        if (!pipeline) throw new Error('Pipeline not found');
        for (const item of state.items.filter((entry) => entry.pipelineId === pipeline.id)) {
          item.subject = clean(item.subject); item.sender = clean(item.sender); item.summary = clean(item.summary);
          const parsed = parseMessage(pipeline.parser, item);
          if (item.kind !== parsed.kind) changed++;
          item.kind = parsed.kind;
          item.facts = parsed.facts;
        }
      });
    } catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Re-parse failed.' }); }
    return { reparsed: changed };
  },
  // Remove from AadOS only (mailbox access is read-only). Ids are remembered so syncs skip them.
  // all=1 removes everything matching the current filters, not just the rows on screen.
  remove: async ({ params, request }) => {
    const form = await request.formData();
    let removed = 0;
    try {
      await updateState((state) => {
        const pipeline = state.pipelines.find((item) => item.id === params.id);
        if (!pipeline) throw new Error('Pipeline not found');
        const mine = state.items.filter((item) => item.pipelineId === pipeline.id);
        const wanted = new Set(form.getAll('ids').map(String));
        const saved = savedParam(form.get('saved'));
        const savedKeys = saved ? new Set(savedOf(state, pipeline)[saved]) : null;
        const victims = form.get('all') === '1'
          ? filterItems(mine, { kind: String(form.get('kind') || ''), store: String(form.get('store') || ''), q: String(form.get('q') || ''), unread: form.get('unread') === '1' }).filter((item) => !savedKeys || savedKeys.has(keyOf(item, pipeline)))
          : mine.filter((item) => wanted.has(item.id));
        const gone = new Set(victims.map((item) => item.id));
        state.items = state.items.filter((item) => !gone.has(item.id));
        state.dismissed.push(...gone);
        removed = gone.size;
      });
    } catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Delete failed.' }); }
    return { removed };
  }
};
