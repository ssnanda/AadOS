// Gmail users.history.list parsing. Pure so it is unit-tested with `node --test`.
// Docs: history records only reach back a limited time; a 404 means the startHistoryId is too old => do a full sync.
export type HistoryDelta = { added: string[]; unread: Record<string, boolean>; historyId: string };

type Raw = Record<string, any>;

/** Fold one or more history.list pages into new message ids and final UNREAD state per message. */
export function foldHistory(pages: Raw[]): HistoryDelta {
  const added: string[] = [], unread: Record<string, boolean> = {};
  let historyId = '';
  for (const page of pages) {
    historyId = String(page.historyId || historyId);
    for (const record of page.history || []) {
      for (const a of record.messagesAdded || []) {
        const id = String(a.message?.id || '');
        if (!id) continue;
        if (!added.includes(id)) added.push(id);
        if (Array.isArray(a.message?.labelIds)) unread[id] = a.message.labelIds.includes('UNREAD');
      }
      for (const l of record.labelsAdded || []) if ((l.labelIds || []).includes('UNREAD') && l.message?.id) unread[String(l.message.id)] = true;
      for (const l of record.labelsRemoved || []) if ((l.labelIds || []).includes('UNREAD') && l.message?.id) unread[String(l.message.id)] = false;
      for (const d of record.messagesDeleted || []) { const id = String(d.message?.id || ''); delete unread[id]; const i = added.indexOf(id); if (i >= 0) added.splice(i, 1); }
    }
  }
  return { added, unread, historyId };
}

export class HistoryExpired extends Error { constructor() { super('Gmail history expired'); } }
