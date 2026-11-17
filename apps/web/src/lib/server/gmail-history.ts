// Gmail users.history.list parsing. Pure so it is unit-tested with `node --test`.
// Docs: history records only reach back a limited time; a 404 means the startHistoryId is too old => do a full sync.
export type HistoryDelta = { added: string[]; removed: string[]; unread: Record<string, boolean>; historyId: string };

type Raw = Record<string, any>;

/**
 * Fold one or more history.list pages into new message ids, ids that left the label, and final UNREAD
 * state per message. With `labelId`, a message that gains the label counts as added and one that loses
 * it (or is trashed / marked spam) counts as removed; the last event wins.
 */
export function foldHistory(pages: Raw[], labelId = ''): HistoryDelta {
  const added = new Set<string>(), removed = new Set<string>(), unread: Record<string, boolean> = {};
  const add = (id: string) => { added.add(id); removed.delete(id); };
  const remove = (id: string) => { removed.add(id); added.delete(id); };
  const leaves = labelId && labelId !== 'TRASH' && labelId !== 'SPAM' ? ['TRASH', 'SPAM'] : [];
  let historyId = '';
  for (const page of pages) {
    historyId = String(page.historyId || historyId);
    for (const record of page.history || []) {
      for (const a of record.messagesAdded || []) {
        const id = String(a.message?.id || '');
        if (!id) continue;
        add(id);
        if (Array.isArray(a.message?.labelIds)) unread[id] = a.message.labelIds.includes('UNREAD');
      }
      for (const l of record.labelsAdded || []) {
        const id = String(l.message?.id || ''), labels: string[] = l.labelIds || [];
        if (!id) continue;
        if (labels.includes('UNREAD')) unread[id] = true;
        if (labelId && labels.includes(labelId)) add(id);
        if (labels.some((x) => leaves.includes(x))) remove(id);
      }
      for (const l of record.labelsRemoved || []) {
        const id = String(l.message?.id || ''), labels: string[] = l.labelIds || [];
        if (!id) continue;
        if (labels.includes('UNREAD')) unread[id] = false;
        if (labelId && labels.includes(labelId)) remove(id);
      }
      for (const d of record.messagesDeleted || []) { const id = String(d.message?.id || ''); if (!id) continue; delete unread[id]; remove(id); }
    }
  }
  return { added: [...added], removed: [...removed], unread, historyId };
}

export class HistoryExpired extends Error { constructor() { super('Gmail history expired'); } }
