// Due-date extraction from email text. Heuristic; returns YYYY-MM-DD (UTC) or ''.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const valid = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m && t.getUTCDate() === d ? t : null; };

/** Month/day without a year: this year, or next year if that date is more than 30 days past. */
function inferYear(m: number, d: number, now: Date): Date | null {
  const y = now.getUTCFullYear();
  const t = valid(y, m, d);
  if (t && now.getTime() - t.getTime() > 30 * 86_400_000) return valid(y + 1, m, d);
  return t;
}

export function extractDue(text: string, now = new Date()): string {
  const s = text.toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/))) return valid(+m[1], +m[2] - 1, +m[3]) ? iso(valid(+m[1], +m[2] - 1, +m[3])!) : '';
  if ((m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/))) {
    const t = m[3] ? valid(+m[3], MONTHS.indexOf(m[1]), +m[2]) : inferYear(MONTHS.indexOf(m[1]), +m[2], now);
    return t ? iso(t) : '';
  }
  if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0;
    const t = year ? valid(year, +m[1] - 1, +m[2]) : inferYear(+m[1] - 1, +m[2], now);
    return t ? iso(t) : '';
  }
  if (/\b(today|tonight)\b/.test(s)) return iso(now);
  if (/\btomorrow\b/.test(s)) return iso(new Date(now.getTime() + 86_400_000));
  if ((m = s.match(/\b(?:by|on|this|before|until)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) {
    const delta = (DAYS.indexOf(m[1]) - now.getUTCDay() + 7) % 7 || 7;
    return iso(new Date(now.getTime() + delta * 86_400_000));
  }
  return '';
}
