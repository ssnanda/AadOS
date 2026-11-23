// Sidebar count badges for the sections above Emails. Calendar/room counts come from stored state (cheap, every page);
// Asana, Finance and Documents need a network/database call, so they are cached for two minutes and streamed to the
// page (never awaited by the layout).
import type { AadOSState } from './aados-store';
import { hasDatabase, database } from './aados-store';
import { can, type SessionUser } from './auth';
import { calendarAccounts } from './scope';
import { agenda } from '../calendar/model';
import { rangeUtc, todayIn } from '../calendar/view';
import { validZone } from '../calendar/model';
import * as asana from './asana';
import { dueDay } from '../asana-model';
import { db as financeDb, recentAlerts } from './finance/db';

const zone = (s: AadOSState) => (validZone(s.prefs.timeZone) ? s.prefs.timeZone : 'UTC');

/** Events today that have not ended yet (all-day ones count all day), optionally on one calendar. */
function remainingToday(state: AadOSState, user: SessionUser | null | undefined, calendarId?: string, now = Date.now()) {
  const tz = zone(state), visible = calendarAccounts(state, user);
  const off = new Set(state.accounts.filter((a) => a.calendarOff).map((a) => a.id));
  const { from, to } = rangeUtc([todayIn(tz, now)], tz);
  const events = state.events.filter((e) => visible.has(e.accountId) && !off.has(e.accountId) && !state.calendarDisabled.includes(e.calendarId));
  return agenda(events, from, to, calendarId ? { calendarIds: [calendarId] } : undefined)
    .filter((o) => o.status !== 'cancelled' && (o.allDay || Date.parse(o.end) > now)).length;
}

/** Same default as the Conference Room page: the chosen calendar, else one whose name says it is a room. */
function roomCalendar(state: AadOSState, user: SessionUser | null | undefined) {
  const visible = calendarAccounts(state, user);
  const cals = state.calendars.filter((c) => visible.has(c.accountId) && !state.calendarDisabled.includes(c.id));
  return (cals.find((c) => c.id === state.prefs.roomCalendarId) || cals.find((c) => /conference|room|meeting/i.test(c.name)))?.id || '';
}

export function localCounts(state: AadOSState, user: SessionUser | null | undefined) {
  if (!can(user, 'calendar') && !user?.ownAccounts) return { calendar: 0, room: 0 };
  const room = roomCalendar(state, user);
  return { calendar: remainingToday(state, user), room: room ? remainingToday(state, user, room) : 0 };
}

type Remote = { asana: number; finance: number; documents: number };
declare global { var __aadosNavCounts: Map<string, { at: number; value: Promise<Remote> }> | undefined; }
const TTL_MS = 120_000;

async function computeRemote(state: AadOSState, user: SessionUser | null | undefined): Promise<Remote> {
  const tz = zone(state), today = todayIn(tz);
  const [asanaCount, finance, documents] = await Promise.all([
    can(user, 'asana') && asana.connectedState(state)
      ? asana.connection().then((c) => asana.myTasks(c)).then((list) => list.filter((t) => { const d = dueDay(t, tz); return Boolean(d && d <= today); }).length).catch(() => 0)
      : 0,
    can(user, 'finance') && hasDatabase() ? financeDb().then((q) => recentAlerts(q, 24)).then((a) => a.length).catch(() => 0) : 0,
    can(user, 'documents') && hasDatabase()
      ? database().then((q) => q.query("SELECT count(*)::int AS n FROM documents WHERE inserted_at > now() - interval '7 days'")).then((r) => Number(r.rows[0]?.n) || 0).catch(() => 0)
      : 0
  ]);
  return { asana: asanaCount, finance, documents };
}

/** Cached per user for two minutes; a failure just shows no badge. */
export function remoteCounts(state: AadOSState, user: SessionUser | null | undefined): Promise<Remote> {
  const cache = (globalThis.__aadosNavCounts ||= new Map());
  const key = user?.owner ? 'owner' : user?.id || 'anon', hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = computeRemote(state, user);
  cache.set(key, { at: Date.now(), value });
  return value;
}
