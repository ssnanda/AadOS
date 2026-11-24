export const KINDS: Record<string, { label: string; icon: string; tone: string }> = {
  coupon: { label: 'Deals & promos', icon: '🏷', tone: 'pink' },
  order: { label: 'Orders', icon: '🧾', tone: 'blue' },
  shipping: { label: 'Shipping', icon: '📦', tone: 'amber' },
  return: { label: 'Returns', icon: '↩', tone: 'violet' },
  appointment: { label: 'Appointments', icon: '📅', tone: 'teal' },
  claim: { label: 'Claims', icon: '📄', tone: 'blue' },
  prescription: { label: 'Prescriptions', icon: '💊', tone: 'pink' },
  bill: { label: 'Bills', icon: '💲', tone: 'amber' },
  promo: { label: 'Promos & notices', icon: '📣', tone: 'gray' },
  other: { label: 'Other', icon: '✉', tone: 'gray' },
  message: { label: 'Messages', icon: '✉', tone: 'gray' }
};
export const kindMeta = (kind: string) => KINDS[kind] ?? { label: kind, icon: '✉', tone: 'gray' };
