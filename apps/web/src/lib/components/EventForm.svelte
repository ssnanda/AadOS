<script lang="ts">
  import { untrack } from 'svelte';
  // New / edit event. Times are the owner's zone; saved straight to Google or Zoho, then the calendar re-syncs.
  type Cal = { id: string; name: string; provider: string; color: string; writable: boolean; primary: boolean };
  type Existing = { eventId: string; calendarId: string; title: string; start: string; end: string; allDay: boolean; location: string; rawDescription: string; recurring: boolean };
  let { calendars, tz, date, existing, onsaved, onclose }: { calendars: Cal[]; tz: string; date: string; existing?: Existing | null; onsaved: () => void; onclose: () => void } = $props();

  const local = (iso: string) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
  const prevDay = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
  const writable = $derived(calendars.filter((c) => c.writable));
  const e = untrack(() => existing), d0 = untrack(() => date); // a fresh form is mounted per event
  const s0 = e && !e.allDay ? local(e.start) : null, e0 = e && !e.allDay ? local(e.end) : null;
  let title = $state(e?.title || ''), location = $state(e?.location || ''), description = $state(e?.rawDescription || '');
  let allDay = $state(e?.allDay ?? false);
  let startDate = $state(e ? (e.allDay ? e.start : s0!.date) : d0), startTime = $state(s0?.time || '09:00');
  let endDate = $state(e ? (e.allDay ? prevDay(e.end) : e0!.date) : d0), endTime = $state(e0?.time || '10:00');
  let calendarId = $state(e?.calendarId || '');
  $effect(() => { if (!calendarId) calendarId = (writable.find((c) => c.primary) || writable[0])?.id || ''; });
  let busy = $state(false), error = $state('');
  const locked = Boolean(e?.recurring);

  async function call(op: 'create' | 'update' | 'delete') {
    if (op === 'delete' && !confirm(e?.recurring ? 'Delete this repeating event — every occurrence?' : 'Delete this event?')) return;
    busy = true; error = '';
    try {
      const res = await fetch('/calendar/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, eventId: e?.eventId, calendarId, input: { title, location, description, allDay, startDate, startTime, endDate, endTime } }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
      onsaved(); onclose();
    } catch (err) { error = err instanceof Error ? err.message : 'Failed.'; }
    finally { busy = false; }
  }
  // Keep the end after the start when the start moves.
  $effect(() => { if (endDate < startDate) endDate = startDate; });
</script>

<div class="backdrop" role="presentation" onclick={(ev) => { if (ev.target === ev.currentTarget) onclose(); }}>
  <form class="sheet" onsubmit={(ev) => { ev.preventDefault(); call(e ? 'update' : 'create'); }}>
    <h3>{e ? 'Edit event' : 'New event'}</h3>
    <!-- svelte-ignore a11y_autofocus -->
    <input class="title" bind:value={title} placeholder="Title" aria-label="Title" autofocus={!e}>
    {#if !e}<label class="row">Calendar <select bind:value={calendarId}>{#each writable as c (c.id)}<option value={c.id}>{c.name} · {c.provider === 'google' ? 'Google' : 'Zoho'}</option>{/each}</select></label>{/if}
    {#if locked}<p class="note">↻ Repeating event: changes apply to every occurrence; its schedule stays as it is (change it in {e && calendars.find((c) => c.id === e.calendarId)?.provider === 'zoho' ? 'Zoho' : 'Google'} Calendar).</p>{/if}
    <fieldset disabled={locked}>
      <label class="chk"><input type="checkbox" bind:checked={allDay}> All day</label>
      <div class="row"><label>Starts <input type="date" bind:value={startDate} required></label>{#if !allDay}<input type="time" bind:value={startTime} required aria-label="Start time">{/if}</div>
      <div class="row"><label>Ends <input type="date" bind:value={endDate} min={startDate} required></label>{#if !allDay}<input type="time" bind:value={endTime} required aria-label="End time">{/if}<small class="muted">{tz}</small></div>
    </fieldset>
    <input bind:value={location} placeholder="Location" aria-label="Location">
    <textarea rows="4" bind:value={description} placeholder="Description" aria-label="Description"></textarea>
    {#if error}<p class="err">{error}</p>{/if}
    <div class="row end">{#if e}<button type="button" class="danger" disabled={busy} onclick={() => call('delete')}>Delete</button><span class="sp"></span>{/if}<button type="button" onclick={onclose}>Cancel</button><button class="primary" disabled={busy || !calendarId}>{busy ? 'Saving…' : 'Save'}</button></div>
  </form>
</div>

<style>
  .backdrop{position:fixed;inset:0;background:#151c2d55;z-index:70;display:grid;place-items:start center;padding:8vh 16px}
  .sheet{background:#fff;border-radius:14px;padding:18px;width:min(520px,100%);display:grid;gap:10px;box-shadow:0 20px 50px #151c2d44;font-size:13px;color:#29344c}
  h3{margin:0}.title{font-size:16px;font-weight:700}
  fieldset{border:0;padding:0;margin:0;display:grid;gap:8px}fieldset:disabled{opacity:.55}
  input,select,textarea{border:1px solid #d9dfeb;border-radius:7px;padding:6px 8px;font:inherit;min-width:0}textarea{resize:vertical}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row label{display:flex;gap:6px;align-items:center;color:#53607a;font-weight:600}label.row{color:#53607a;font-weight:600}
  .chk{display:flex;gap:6px;align-items:center;color:#53607a}.end{justify-content:flex-end}.sp{flex:1}.muted{color:#8a95a8}
  .note{margin:0;background:#f4f6fb;border-radius:8px;padding:7px 9px;color:#53607a;font-size:12px}.err{color:#a5414d;margin:0}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:7px 14px;font-weight:700;color:#43516c;cursor:pointer}.primary{background:#3157de;border-color:#3157de;color:#fff}.danger{color:#b53c50}
</style>
