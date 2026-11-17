// Mock calendar seed + page checks for the THROWAWAY e2e stack (compose project aados-e2e, port 3199). Never the real DB.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const tz = 'America/New_York';
const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
const add = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// Local wall time -> UTC ISO (EST = UTC-5 in November; fine for a mock seed).
const at = (d, hm) => new Date(`${d}T${hm}:00-05:00`).toISOString();
const ev = (o) => ({ description: '', location: '', allDay: false, timeZone: tz, status: 'confirmed', ...o });
const g = 'g1:primary', gw = 'g1:work', z = 'z1:zc', off = 'g1:off';
const state = {
  accounts: [
    { id: 'g1', provider: 'gmail', email: 'mock@gmail.test', remoteId: '', accessToken: '', refreshToken: '', expiresAt: 0, folders: [], calendar: true },
    { id: 'z1', provider: 'zoho', email: 'mock@zoho.test', remoteId: '1', accessToken: '', refreshToken: '', expiresAt: 0, folders: [], calendar: true }
  ],
  pipelines: [], items: [], dismissed: [], tasks: [], reminders: [], calendarSync: {}, calendarDisabled: [off],
  prefs: { timeZone: tz, eventLeadMinutes: 15, taskReminderTime: '09:00', weekStart: 0 },
  calendars: [
    { id: g, accountId: 'g1', provider: 'google', providerCalendarId: 'primary', name: 'Personal', timeZone: tz, primary: true, color: '#d6477f' },
    { id: gw, accountId: 'g1', provider: 'google', providerCalendarId: 'work', name: 'Family', timeZone: tz, primary: false, color: '' },
    { id: off, accountId: 'g1', provider: 'google', providerCalendarId: 'off', name: 'Disabled cal', timeZone: tz, primary: false, color: '#000000' },
    { id: z, accountId: 'z1', provider: 'zoho', providerCalendarId: 'zc', name: 'Zoho Home', timeZone: 'Asia/Kolkata', primary: true, color: '#8cbf40' }
  ],
  events: [
    ev({ id: 'g1:dent', accountId: 'g1', calendarId: g, provider: 'google', providerEventId: 'dent', title: 'MOCK Dentist', start: at(today, '23:00'), end: at(today, '23:45'), location: '12 Main St', description: '<p>Bring <b>insurance card</b></p>', organizer: 'Dr Mock <dr@clinic.test>', attendees: [{ email: 'mock@gmail.test', status: 'accepted' }, { email: 'spouse@x.test', name: 'Spouse', status: 'needsAction' }], meetingUrl: 'https://zoom.us/j/999', htmlLink: 'https://calendar.google.com/mock' }),
    ev({ id: 'g1:stand', accountId: 'g1', calendarId: gw, provider: 'google', providerEventId: 'stand', title: 'MOCK Standup', start: at(add(today, -14), '09:00'), end: at(add(today, -14), '09:30'), recurrence: ['RRULE:FREQ=DAILY'] }),
    ev({ id: 'g1:trip', accountId: 'g1', calendarId: g, provider: 'google', providerEventId: 'trip', title: 'MOCK Trip', allDay: true, start: add(today, 2), end: add(today, 5), timeZone: 'UTC' }),
    ev({ id: 'z1:gym', accountId: 'z1', calendarId: z, provider: 'zoho', providerEventId: 'gym', title: 'MOCK Gym', start: at(add(today, 1), '07:00'), end: at(add(today, 1), '08:00'), timeZone: 'Asia/Kolkata', status: 'tentative' }),
    ev({ id: 'g1:hid', accountId: 'g1', calendarId: off, provider: 'google', providerEventId: 'hid', title: 'MOCK HiddenEvent', start: at(today, '10:00'), end: at(today, '11:00') })
  ]
};

const key = createHmac('sha256', 'e2e1111111111111111111111111111111111111111111111111111111111111111111111111').update('e2e-hash').digest();
const payload = Buffer.from(JSON.stringify({ iat: Date.now(), expires: Date.now() + 3600_000 })).toString('base64url');
const cookie = `aados_session=${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
const B = 'http://127.0.0.1:3199';
const mode = process.argv[2];

if (mode === 'seed') {
  const sql = `INSERT INTO app_state (id, data, version, inserted_at, updated_at) VALUES (1, $json$${JSON.stringify(state)}$json$::jsonb, 1, now(), now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;`;
  execFileSync('docker', ['exec', '-i', 'aados-e2e-db-1', 'psql', '-U', 'aados', '-d', 'aados', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
  console.log('seeded mock state into aados-e2e');
} else if (mode === 'check') {
  let failed = 0;
  const page = async (path) => (await fetch(B + path, { headers: { Cookie: cookie } })).text();
  const check = async (name, path, present = [], absent = []) => {
    const html = await page(path);
    const miss = present.filter((t) => !html.includes(t)), extra = absent.filter((t) => html.includes(t));
    failed += miss.length + extra.length;
    console.log(`${miss.length + extra.length ? '✗' : '✓'} ${name}${miss.length ? ` | MISSING: ${miss.join(', ')}` : ''}${extra.length ? ` | UNEXPECTED: ${extra.join(', ')}` : ''}`);
  };
  const tomorrow = add(today, 1), midTrip = add(today, 3);
  await check('month: all enabled calendars combined, disabled hidden', '/calendar', ['MOCK Dentist', 'MOCK Standup', 'MOCK Trip', 'MOCK Gym', 'Personal', 'Zoho Home', 'Family', 'Today'], ['MOCK HiddenEvent']);
  await check('week', '/calendar?view=week', ['MOCK Dentist', 'MOCK Trip', 'MOCK Gym', 'MOCK Standup']);
  await check('day (today)', '/calendar?view=day', ['MOCK Dentist', 'MOCK Standup', '12 Main St'], ['MOCK Gym', 'MOCK Trip']);
  await check('day (tomorrow): zoho event, tentative, recurring instance', `/calendar?view=day&date=${tomorrow}`, ['MOCK Gym', 'tentative', 'MOCK Standup'], ['MOCK Dentist']);
  await check('day (mid multi-day trip)', `/calendar?view=day&date=${midTrip}`, ['MOCK Trip', 'All day']);
  await check('agenda with recurrence marker', '/calendar?view=agenda', ['MOCK Dentist', 'MOCK Trip', 'MOCK Gym', '↻']);
  await check('account filter (Zoho only)', '/calendar?view=agenda&account=z1', ['MOCK Gym'], ['MOCK Dentist', 'MOCK Standup']);
  await check('calendar filter (hide Personal)', '/calendar?view=agenda&off=g1:primary', ['MOCK Standup', 'MOCK Gym'], ['MOCK Dentist', 'MOCK Trip']);
  await check('navigation links present', '/calendar?view=week', ['aria-label="Previous"', 'aria-label="Next"', 'view=day', 'Manage calendars']);
  await check('dashboard: today, week, quick actions', '/', ['MOCK Dentist', 'Next 7 days', 'Sync Calendars', 'Open Calendar', 'Create Reminder', 'Add Task', 'Open Inbox']);
  await check('settings: per-calendar toggles', '/settings/emails', ['Disabled cal (off)', 'Personal', 'Zoho Home']);
  await check('settings: reminder prefs', '/settings', ['Event reminder', 'Task reminder time', 'America/New_York']);
  // detail data is embedded for the panel: organizer, attendees, meeting link, sanitised description
  const month = await page('/calendar');
  for (const t of ['Dr Mock', 'spouse@x.test', 'https://zoom.us/j/999', 'insurance card']) { const ok = month.includes(t); if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} detail data: ${t}`); }
  const tagLeak = month.includes('<b>insurance card</b>'); if (tagLeak) failed++; console.log(`${tagLeak ? '✗' : '✓'} description HTML is stripped`);
  console.log(failed ? `FAILED: ${failed}` : 'ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
} else if (mode === 'cookie') process.stdout.write(cookie);
