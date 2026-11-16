import type { PipelineItem } from './aados-store';

export type ItemFilter = { kind?: string; store?: string; q?: string };
const haystack = (item: PipelineItem) => `${item.subject} ${item.sender} ${item.summary} ${item.kind} ${Object.values(item.facts).join(' ')}`.toLowerCase();

/** Every search word must appear somewhere in subject, sender, summary, kind or parsed facts. */
export function filterItems(items: PipelineItem[], { kind, store, q }: ItemFilter): PipelineItem[] {
  const terms = (q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => (!kind || item.kind === kind) && (!store || item.facts.store === store) && (!terms.length || terms.every((term) => haystack(item).includes(term))));
}
