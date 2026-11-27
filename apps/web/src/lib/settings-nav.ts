// Settings pages, shared by the Settings tabs and the header's Settings dropdown.
// This is the starting order; both menus then show the most-opened pages first (byUsage, per browser).
export const SETTINGS_PAGES = [
  { href: '/settings/rules', label: 'Rules', icon: '☰' },
  { href: '/settings/emails', label: 'Emails & Calendar', icon: '✉' },
  { href: '/settings/views', label: 'Views', icon: '▦' },
  { href: '/settings', label: 'General', icon: '⚙' },
  { href: '/settings/family', label: 'Family', icon: '👪' },
  { href: '/settings/messages', label: 'Messages', icon: '💬' },
  { href: '/settings/ai', label: 'AI', icon: '✦' },
  { href: '/settings/storage', label: 'Storage', icon: '▤' }
];

// Usage counts (this browser): opening a page bumps it; menus sort by count, ties keep the list order.
const USAGE_KEY = 'aados.usage.v1';
const readUsage = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'); } catch { return {}; } };
export function bumpUsage(id: string) {
  try { const u = readUsage(); u[id] = (u[id] || 0) + 1; localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch { /* private mode: no ordering */ }
}
export function byUsage<T extends { href: string }>(items: T[]): T[] {
  if (typeof localStorage === 'undefined') return items;
  const u = readUsage();
  return items.map((item, i) => ({ item, i })).sort((a, b) => (u[b.item.href] || 0) - (u[a.item.href] || 0) || a.i - b.i).map((x) => x.item);
}
