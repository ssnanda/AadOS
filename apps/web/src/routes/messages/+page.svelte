<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount, tick, untrack } from 'svelte';
  import AppShell from '$lib/components/AppShell.svelte';
  import { asanaApi } from '$lib/asana-client';
  import { addressKey, brandKey, brandOf, isShortCode, preview, prettyAddress, suggestGroups, CATEGORIES, type Chat, type Message, type MsgGroup, type Template } from '$lib/messages-model';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  let chats = $state<Chat[]>([]), unread = $state<string[]>([]), openGuid = $state(''), messages = $state<Message[]>([]);
  let loading = $state(false), draft = $state(''), sending = $state(false), notice = $state(''), filter = $state(''), live = $state(false);
  let summary = $state(''), summarizing = $state(false), composing = $state(false), newTo = $state(''), newText = $state('');
  let asanaFor = $state<{ guid: string; name: string; notes: string; day: string; busy: boolean; note: string } | null>(null);
  let scroller: HTMLDivElement | undefined = $state();
  let cat = $state(''), suggesting = $state(false), suggestion = $state<{ category: string; why: string; template: string | null } | null>(null);
  let templates = $state<Template[]>([]), managing = $state(false), editTpl = $state<Template | null>(null), refreshing = $state(false);
  let spamSet = $state(new Set<string>());
  let doneSet = $state(new Set<string>()); // spam senders whose stop reply was delivered → Spam reports
  let ctx = $state<{ x: number; y: number; row: Row } | null>(null); // right-click menu on a conversation
  let groups = $state<MsgGroup[]>([]), picked = $state<string[]>([]), selecting = $state(false), similarOpen = $state(false);
  $effect(() => { const d = data; untrack(() => { templates = d.templates; groups = d.groups; if (d.connected) { chats = d.chats; unread = d.unread; spamSet = new Set((d as { spam?: string[] }).spam ?? []); doneSet = new Set((d as { spamDone?: string[] }).spamDone ?? []); } }); });

  // Rows: a sender group ("Atrium notifications") collapses its conversations into one row; others are one row each.
  type Row = Chat & { members: string[]; groupId?: string };
  const groupByAddr = $derived(new Map(groups.flatMap((g) => g.addresses.map((a) => [a, g] as const))));
  const groupFor = (c: Chat) => (!c.group && c.participants.length === 1 ? groupByAddr.get(addressKey(c.participants[0])) : undefined);
  const rows = $derived.by(() => {
    const out: Row[] = [], byGroup = new Map<string, Row>();
    for (const c of chats) {
      const g = groupFor(c);
      if (!g) { out.push({ ...c, members: [c.guid] }); continue; }
      const r = byGroup.get(g.id);
      if (r) { r.members.push(c.guid); r.participants = [...r.participants, ...c.participants]; if ((c.last?.at || 0) > (r.last?.at || 0)) r.last = c.last; }
      else { const nr: Row = { ...c, guid: `group:${g.id}`, title: g.name, participants: [...c.participants], members: [c.guid], groupId: g.id }; byGroup.set(g.id, nr); out.push(nr); }
    }
    return out.sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0));
  });
  const rowUnread = (r: Row) => r.members.some((g) => unread.includes(g));
  /** Spam: senders you sent the stop-solicitation reply to (or moved by hand). Never in the main view. */
  const isSpamRow = (r: Row) => !r.group && !isReportRow(r) && r.participants.some((p) => spamSet.has(addressKey(p)));
  /** Spam reports: the carrier thread (7726, your reports and AT&T's replies) plus spam senders whose stop reply was delivered. */
  const isReportRow = (r: Row) => !r.group && r.participants.some((p) => addressKey(p) === '7726' || (doneSet.has(addressKey(p)) && spamSet.has(addressKey(p))));
  async function setSpam(r: Row, spam: boolean) {
    const addresses = r.participants.map(addressKey);
    try { spamSet = new Set((await api('spam.set', { addresses, spam })).spam); notice = spam ? 'Moved to Spam.' : 'Moved back to your conversations.'; if (!spam) doneSet = new Set([...doneSet].filter((a) => !addresses.includes(a))); if (spam && cat !== 'spam') openGuid = ''; } catch (e) { notice = (e as Error).message; }
  }
  async function setDone(r: Row, done: boolean) {
    const addresses = r.participants.map(addressKey);
    try { const res = await api('spam.done', { addresses, done }); spamSet = new Set(res.spam); doneSet = new Set(res.spamDone); notice = done ? 'Moved to Spam reports.' : 'Moved back to Spam.'; if (openGuid === r.guid) openGuid = ''; } catch (e) { notice = (e as Error).message; }
  }
  const menuFor = (e: MouseEvent, r: Row) => { if (r.group || r.groupId || r.participants.some((p) => addressKey(p) === '7726')) return; e.preventDefault(); ctx = { x: Math.min(e.clientX, innerWidth - 200), y: Math.min(e.clientY, innerHeight - 120), row: r }; };
  /** Chat to send to / summarize for a row: its most recent member conversation. */
  const primary = (r: Row | undefined) => (r ? [...r.members].sort((a, b) => (chats.find((c) => c.guid === b)?.last?.at || 0) - (chats.find((c) => c.guid === a)?.last?.at || 0))[0] : '');
  const similar = $derived(data.connected ? suggestGroups(chats, groups, data.people) : []);
  async function addToGroup(name: string, addresses: string[], id = '') {
    if (!name.trim() || !addresses.length) return;
    try { groups = (await api('groups.add', { name, addresses, id })).groups; picked = []; selecting = false; notice = `Saved to “${name}”.`; } catch (e) { notice = (e as Error).message; }
  }
  const addrsOf = (guids: string[]) => [...new Set(guids.flatMap((g) => chats.find((c) => c.guid === g)?.participants || []).map(addressKey))];
  async function groupPicked() {
    const name = prompt(`Group ${picked.length} conversation(s) as one contact. Name:`, groups[0]?.name || (brandOf(chats.find((c) => c.guid === picked[0])?.last?.text || '') ? `${brandOf(chats.find((c) => c.guid === picked[0])?.last?.text || '')} notifications` : ''));
    if (name) await addToGroup(name, addrsOf(picked), groups.find((g) => g.name.toLowerCase() === name.toLowerCase())?.id || '');
  }
  async function ungroup(id: string) { if (!confirm('Split this group back into separate conversations?')) return; try { groups = (await api('groups.delete', { id })).groups; openGuid = ''; } catch (e) { notice = (e as Error).message; } }
  /** A participant's name from Google Contacts, else the formatted number. */
  const nameOf = (a: string) => (data.connected ? data.people[addressKey(a)] : '') || prettyAddress(a);
  const catOf = (guid: string) => (data.connected ? (data.categories as Record<string, string>)[guid] : '') || 'unknown';
  // "Needs you": unread, or the last message is theirs and you haven't replied (last 30 days). Tiles count only these.
  const REPLY_WINDOW = 30 * 86_400_000;
  /** Waiting on you to answer: a person wrote last (automated short codes and grouped notification senders never count). */
  const awaiting = (r: Row) => Boolean(r.last && !r.last.fromMe && !r.groupId && !isShortCode(r.participants[0] || '') && Date.now() - r.last.at < REPLY_WINDOW);
  const needsYou = (r: Row) => !isSpamRow(r) && !isReportRow(r) && (data.showAll || rowUnread(r) || awaiting(r));
  const rowCat = (r: Row) => catOf(r.members[0]);
  const tile = (id: string) => { const list = rows.filter((r) => (!id || rowCat(r) === id) && needsYou(r)); return { total: list.length, unread: list.filter(rowUnread).length }; };
  async function refreshNow() { refreshing = true; await invalidateAll(); refreshing = false; }
  async function suggest() {
    suggesting = true; suggestion = null;
    try { const r = await api('suggest', { chatGuid: primary(open) }); draft = r.reply; suggestion = { category: r.category, why: r.why, template: r.template }; } catch (e) { notice = (e as Error).message; } finally { suggesting = false; }
  }
  async function saveTemplate() { const t = editTpl; if (!t) return; try { templates = (await api('templates.save', t)).templates; editTpl = null; } catch (e) { notice = (e as Error).message; } }
  async function deleteTemplate(id: string) { if (!confirm('Delete this reply?')) return; try { templates = (await api('templates.delete', { id })).templates; } catch (e) { notice = (e as Error).message; } }
  const open = $derived(rows.find((r) => r.guid === openGuid));
  // Send as SMS: an SMS thread, or the last message I sent failed / went as SMS (a number not on iMessage). The composer
  // chip overrides it per conversation.
  let smsPick = $state<Record<string, boolean>>({});
  let retrying = $state('');
  const lastMine = $derived([...messages].reverse().find((m) => m.fromMe));
  const oneToOne = $derived(Boolean(open && !open.group && open.participants.length === 1));
  const asSms = $derived(oneToOne && open ? (smsPick[open.guid] ?? (open.sms || Boolean(lastMine?.error) || /^(SMS|RCS)$/i.test(lastMine?.service || ''))) : false);
  /** For an ungrouped open conversation: the group it probably belongs to (same brand), or a new one to create. */
  const openHint = $derived.by(() => { if (!open || open.groupId || open.group) return null; const b = brandOf(open.last?.text || ''); if (!b) return null; const g = groups.find((x) => brandKey(x.name) === brandKey(b)); return { name: g?.name || `${b} notifications`, id: g?.id || '' }; });
  const needsAll = $derived(tile(''));
  const spamRows = $derived(rows.filter(isSpamRow));
  const reportRows = $derived(rows.filter(isReportRow));
  const shown = $derived(rows.filter((c) => (cat === 'spam' ? isSpamRow(c) : cat === 'reports' ? isReportRow(c) : (!cat || rowCat(c) === cat) && needsYou(c)) && (!filter || c.title.toLowerCase().includes(filter.toLowerCase()) || preview(c.last).toLowerCase().includes(filter.toLowerCase()))));
  const today = new Date().toISOString().slice(0, 10);
  const when = (ms: number) => { if (!ms) return ''; const d = new Date(ms); return Date.now() - ms < 86_400_000 && d.getDate() === new Date().getDate() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const stamp = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const api = async (op: string, payload: Record<string, unknown> = {}) => {
    const res = await fetch('/messages/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, ...payload }) }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: 'Could not reach AadOS.' };
    if (!res?.ok || body.error) throw new Error(body.error || `HTTP ${res?.status}`);
    return body;
  };
  const toBottom = async () => { await tick(); scroller?.scrollTo({ top: scroller.scrollHeight }); };

  async function select(guid: string) {
    const row = rows.find((r) => r.guid === guid); if (!row) return;
    openGuid = guid; messages = []; summary = ''; suggestion = null; loading = true; notice = '';
    // A group shows every member conversation merged by time.
    try { const parts = await Promise.all(row.members.map((m) => api('thread', { chatGuid: m }).then((r) => r.messages as Message[]))); messages = parts.flat().sort((a, b) => a.at - b.at); await toBottom(); } catch (e) { notice = (e as Error).message; } finally { loading = false; }
    for (const m of row.members) if (unread.includes(m)) { unread = unread.filter((g) => g !== m); api('read', { chatGuid: m }).catch(() => undefined); }
  }
  async function send() {
    const text = draft.trim(), target = primary(open); if (!text || !target) return;
    sending = true; notice = '';
    const temp: Message = { guid: `temp-${Date.now()}`, chatGuid: target, text, fromMe: true, sender: '', at: Date.now(), attachments: [], error: false, read: true };
    messages = [...messages, temp]; draft = ''; await toBottom();
    // SMS threads (one person) are sent explicitly as SMS.
    const smsTo = asSms && open ? open.participants[0] : '';
    // For a spam reply that reports to 7726, the server forwards their latest text there too.
    const reportText = [...messages].reverse().find((m) => !m.fromMe && m.text.trim())?.text || '';
    try { const r = await api('send', { chatGuid: target, text, sms: Boolean(smsTo), address: smsTo, addresses: open?.group ? [] : open?.participants || [], reportText });
      if (r.spammed && open) { for (const p of open.participants) spamSet.add(addressKey(p)); spamSet = new Set(spamSet); notice = r.reported ? 'Sent — moved to Spam and reported to 7726 (their text now, their number in ~20 s).' : 'Sent — conversation moved to Spam.'; } if (r.message) messages = messages.map((m) => (m.guid === temp.guid ? r.message : m)); bump(target, r.message || temp); if (r.smsNote) notice = r.smsNote; }
    catch (e) { notice = (e as Error).message; messages = messages.map((m) => (m.guid === temp.guid ? { ...m, error: true } : m)); draft = text; }
    finally { sending = false; }
  }
  /** Resend a failed message as SMS (e.g. iMessage could not deliver to a non-iPhone number). */
  async function retrySms(m: Message) {
    const to = oneToOne && open ? open.participants[0] : '';
    if (!to || !open) { notice = 'Retry as SMS works for one-to-one conversations.'; return; }
    if (retrying) return;
    retrying = m.guid; notice = 'Sending as SMS…';
    const rowGuid = open.guid;
    smsPick = { ...smsPick, [rowGuid]: true }; // later replies in this conversation go as SMS too
    try { const r = await api('send', { chatGuid: m.chatGuid || primary(open), text: m.text, sms: true, address: to }); messages = [...messages, r.message || { ...m, guid: `temp-${Date.now()}`, error: false, at: Date.now(), service: 'SMS' }]; notice = r.smsNote || 'Sent as SMS — checking delivery…'; await toBottom();
      // Delivery failures arrive after the send; reload the conversation to show them.
      setTimeout(() => { if (openGuid === rowGuid) void select(rowGuid).then(() => { if (lastMine?.error) notice = 'SMS also failed. On the Mac: iPhone → Settings → Messages → Text Message Forwarding must include this Mac.'; }); }, 8000); }
    catch (e) { notice = `SMS failed: ${(e as Error).message}`; }
    finally { retrying = ''; }
  }
  async function startChat() {
    try { await api('newChat', { address: newTo, text: newText }); composing = false; newTo = ''; newText = ''; await invalidateAll(); } catch (e) { notice = (e as Error).message; }
  }
  /** Move a chat to the top with its newest message. */
  function bump(guid: string, m: Message) { const c = chats.find((x) => x.guid === guid); if (c) chats = [{ ...c, last: m }, ...chats.filter((x) => x.guid !== guid)]; }
  async function summarize() { summarizing = true; try { summary = (await api('summary', { chatGuid: primary(open) })).text; } catch (e) { notice = (e as Error).message; } finally { summarizing = false; } }
  async function toAsana(m: Message) {
    asanaFor = { guid: m.guid, name: m.text.split('\n')[0].slice(0, 120) || 'Follow up', notes: `From: ${m.fromMe ? 'Me' : prettyAddress(m.sender)} (${open?.title || ''})\n${stamp(m.at)}\n\n${m.text}`, day: today, busy: data.aiAvailable, note: '' };
    if (data.aiAvailable) {
      try { const d = await api('asanaDraft', { chatGuid: m.chatGuid || primary(open), guid: m.guid }); if (asanaFor?.guid === m.guid) asanaFor = { ...asanaFor, name: d.name, notes: d.notes ? `${d.notes}\n\n———\n${asanaFor.notes}` : asanaFor.notes, day: d.due, busy: false, note: '✦ Drafted by AI — check it before creating.' }; }
      catch { if (asanaFor) asanaFor = { ...asanaFor, busy: false, note: 'AI draft unavailable; filled from the message.' }; }
    }
  }
  async function createAsana() {
    const a = asanaFor; if (!a) return;
    try { await asanaApi('create', { name: a.name, notes: a.notes, day: a.day }); notice = 'Asana task created.'; asanaFor = null; } catch (e) { if (asanaFor) asanaFor = { ...asanaFor, note: (e as Error).message }; }
  }

  // Live: BlueBubbles' webhook → /messages/stream (Server-Sent Events). New texts appear without refreshing.
  onMount(() => {
    if (!data.connected) return;
    // From Contacts: /messages?to=+1… opens New message for that number.
    const to = new URL(location.href).searchParams.get('to');
    if (to) { composing = true; newTo = to; }
    // From the Dashboard: /messages?chat=<guid> opens that conversation.
    const chat = new URL(location.href).searchParams.get('chat');
    if (chat) void select(chat);
    const es = new EventSource('/messages/stream');
    es.onopen = () => (live = true);
    es.onerror = () => (live = false);
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data) as { type: string; chatGuid: string; message?: Message };
      if (e.type === 'new-message' && e.message) {
        const m = e.message;
        if (!chats.some((c) => c.guid === e.chatGuid)) { invalidateAll(); return; }
        bump(e.chatGuid, m);
        if (open?.members.includes(e.chatGuid)) { if (!messages.some((x) => x.guid === m.guid)) { messages = [...messages.filter((x) => !(x.guid.startsWith('temp-') && x.text === m.text && m.fromMe)), m]; toBottom(); } if (!m.fromMe && document.visibilityState === 'visible') api('read', { chatGuid: e.chatGuid }).catch(() => undefined); }
        else if (!m.fromMe && !unread.includes(e.chatGuid)) unread = [...unread, e.chatGuid];
      } else if (e.type === 'updated-message' && e.message && e.chatGuid === openGuid) messages = messages.map((x) => (x.guid === e.message!.guid ? e.message! : x));
    };
    // Backup to live updates: re-read the list every minute while this tab is visible.
    const t = setInterval(() => { if (document.visibilityState === 'visible' && !sending) invalidateAll(); }, 60_000);
    return () => { es.close(); clearInterval(t); };
  });
</script>

<svelte:head><title>Messages · AadOS</title></svelte:head>
<AppShell title="Messages">
<main>
  {#if !data.connected}
    <section class="empty"><h1>Messages</h1><p>Connect your Mac's BlueBubbles server to see and answer your iMessages here.</p>{#if data.owner}<a class="primary" href="/settings/messages">Set up Messages</a>{:else}<p class="muted">Ask the owner to connect it.</p>{/if}</section>
  {:else}
  {#if data.error}<div class="alert">{data.error}{#if data.owner} · <a href="/settings/messages">Settings</a>{/if}</div>{/if}
  {#if notice}<div class="alert soft">{notice} <button class="link" onclick={() => (notice = '')}>✕</button></div>{/if}
  <div class="tiles">
    <button class="tilebtn" class:on={!cat} onclick={() => (cat = '')} title="Unread, or waiting for your reply (last 30 days)"><span>💬</span><b>{needsAll.total}</b><small>Needs you{needsAll.unread ? ` · ${needsAll.unread} unread` : ''}</small></button>
    {#each CATEGORIES as t (t.id)}{@const n = tile(t.id)}<button class="tilebtn {t.id}" class:on={cat === t.id} class:zero={!n.total} onclick={() => (cat = cat === t.id ? '' : t.id)}><span>{t.icon}</span><b>{n.total}</b><small>{t.label}{n.unread ? ` · ${n.unread} unread` : ''}</small></button>{/each}
    <button class="tilebtn spam" class:on={cat === 'spam'} class:zero={!spamRows.length} onclick={() => (cat = cat === 'spam' ? '' : 'spam')} title="Senders you told to stop (never shown in the main view)"><span>🚫</span><b>{spamRows.length}</b><small>Spam</small></button>
    <button class="tilebtn spam" class:on={cat === 'reports'} class:zero={!reportRows.length} onclick={() => (cat = cat === 'reports' ? '' : 'reports')} title="Senders whose stop reply was delivered, plus your 7726 reports and AT&amp;T's replies"><span>📨</span><b>{reportRows.length}</b><small>Spam reports</small></button>

  </div>
  <div class="showall"><label><input type="checkbox" checked={data.showAll} onchange={(e) => goto(e.currentTarget.checked ? '?all=1' : '?', { keepFocus: true, noScroll: true })}> Show all conversations <small>(not only unread / awaiting reply · searches older history)</small></label>
    <button class="link" onclick={() => (similarOpen = !similarOpen)}>🔎 Find similar senders{similar.length ? ` (${similar.length})` : ''}</button></div>
  {#if similarOpen}<div class="similar">{#each similar as sg (sg.name)}<div class="srow"><b>{sg.name}</b><small>{sg.guids.length} conversation{sg.guids.length === 1 ? '' : 's'}: {sg.guids.map((g) => chats.find((c) => c.guid === g)?.title).join(', ')}</small><span class="sp"></span><button class="primary small" onclick={() => addToGroup(sg.name, sg.addresses, sg.groupId || '')}>{sg.groupId ? `Add to ${sg.name}` : 'Create contact'}</button></div>{:else}<p class="muted">No similar senders found{data.showAll ? '' : ' — tick Show all to search older conversations'}.</p>{/each}</div>{/if}
  <div class="statusbar"><span class:on={live}>{live ? '● Live' : '○ Reconnecting…'}</span><span>Updated {new Date(data.loadedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><button class="link" onclick={refreshNow} disabled={refreshing}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
    <span class="sp"></span><span class="muted" title="Names for phone numbers come from Google Contacts">Names: {data.nameSources.google} from Google Contacts</span>{#if !data.contactsOn && data.owner}<a href="/settings/emails">Turn on Google Contacts</a>{/if}{#each data.contactErrors as e (e)}<span class="err">{e}</span>{/each}</div>
  <div class="wrap" class:reading={Boolean(openGuid)}>
    <aside class="list">
      <div class="lhead"><input type="search" bind:value={filter} placeholder="Search conversations" aria-label="Search conversations"><button class="new" title="Select conversations to group them" aria-label="Select" class:on={selecting} onclick={() => { selecting = !selecting; picked = []; }}>☑</button><button class="new" title="New message" aria-label="New message" onclick={() => (composing = !composing)}>✎</button></div>
      {#if selecting}<div class="pickbar">{picked.length} selected<span class="sp"></span><button class="primary small" disabled={!picked.length} onclick={groupPicked}>Group as one contact…</button></div>{/if}
      {#if composing}<form class="compose" onsubmit={(e) => { e.preventDefault(); startChat(); }}><input bind:value={newTo} placeholder="Name, phone number or email" list="msg-contacts" aria-label="To"><datalist id="msg-contacts">{#each data.contacts as p (p.address)}<option value={p.address}>{p.name}</option>{/each}</datalist><textarea bind:value={newText} rows="2" placeholder="Message"></textarea><button class="primary">Send</button></form>{/if}
      <ul>{#each shown as c (c.guid)}
        <li class="crow">{#if selecting && !c.groupId}<input type="checkbox" checked={c.members.every((m) => picked.includes(m))} onchange={(e) => (picked = e.currentTarget.checked ? [...new Set([...picked, ...c.members])] : picked.filter((m) => !c.members.includes(m)))} aria-label={`Select ${c.title}`}>{/if}<button class="chat" class:on={c.guid === openGuid} class:unread={rowUnread(c)} onclick={() => select(c.guid)} oncontextmenu={(e) => menuFor(e, c)}>
          <span class="av" class:grp={c.group || c.groupId}>{c.groupId ? '🏷' : c.group ? '👥' : c.title.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || '#'}</span>
          <span class="meta"><span class="row1"><strong>{c.title}{#if c.sms}<em class="sms">SMS</em>{/if}</strong><time>{when(c.last?.at || 0)}</time></span><span class="pv">{c.last?.fromMe ? 'You: ' : ''}{preview(c.last)}</span>{#if c.groupId}<em class="gcount">{c.members.length} senders</em>{:else if !rowUnread(c) && awaiting(c)}<em class="await">awaiting your reply</em>{/if}</span>
          {#if rowUnread(c)}<i class="dot"></i>{/if}
        </button></li>{:else}<li class="muted pad">No conversations.</li>{/each}</ul>
    </aside>
    <section class="thread">
      {#if !open}<p class="muted pad">Pick a conversation.</p>
      {:else}
        <header><button class="back" onclick={() => (openGuid = '')} aria-label="Back">‹</button><div><strong>{open.title}</strong>{#if open.group}<small>{open.participants.map(nameOf).join(', ')}</small>{:else}<small>{open.participants.map((p) => (nameOf(p) !== prettyAddress(p) ? `${nameOf(p)} · ${prettyAddress(p)}` : prettyAddress(p))).join(', ')}</small>{/if}</div>
          {#if !open.group && !open.participants.some((p) => addressKey(p) === '7726')}{#if isSpamRow(open) || isReportRow(open)}<button onclick={() => open && setSpam(open, false)}>Not spam</button>{:else}<button onclick={() => open && setSpam(open, true)} title="Move to Spam: never shown in your main view">🚫 Spam</button>{/if}{/if}
          {#if open.groupId}<button onclick={() => open?.groupId && ungroup(open.groupId)}>Ungroup</button>{:else if !open.group}<button onclick={() => { const n = prompt('Save this sender as (existing or new contact name):', openHint?.name || groups[0]?.name || ''); if (n && open) addToGroup(n, addrsOf(open.members), groups.find((g) => g.name.toLowerCase() === n.toLowerCase())?.id || ''); }}>🏷 Name sender…</button>{/if}
          {#if data.aiAvailable}<button onclick={summarize} disabled={summarizing}>✦ {summarizing ? 'Summarizing…' : 'Summarize'}</button>{/if}</header>
        {#if openHint}<div class="hint">Looks like <b>{openHint.name}</b>. <button class="primary small" onclick={() => open && openHint && addToGroup(openHint.name, addrsOf(open.members), openHint.id)}>{openHint.id ? `Add to ${openHint.name}` : `Create “${openHint.name}”`}</button> <span class="muted">— then Find similar to add the rest.</span></div>{/if}
        {#if summary}<div class="summary"><pre>{summary}</pre><button class="link" onclick={() => (summary = '')}>✕</button></div>{/if}
        <div class="msgs" bind:this={scroller}>
          {#if loading}<p class="muted pad">Loading…</p>{/if}
          {#each messages as m, i (m.guid)}
            {#if i === 0 || m.at - messages[i - 1].at > 3_600_000}<p class="ts">{stamp(m.at)}</p>{/if}
            <div class="bubble" class:me={m.fromMe} class:err={m.error}>
              {#if open.group && !m.fromMe && (i === 0 || messages[i - 1].sender !== m.sender)}<small class="who">{nameOf(m.sender)}</small>{/if}
              {#each m.attachments as a (a.guid)}{#if a.mime.startsWith('image/') && !/heic/i.test(a.mime)}<a href={`/messages/attachment/${encodeURIComponent(a.guid)}`} target="_blank" rel="noopener"><img src={`/messages/attachment/${encodeURIComponent(a.guid)}`} alt={a.name} loading="lazy"></a>{:else}<a class="file" href={`/messages/attachment/${encodeURIComponent(a.guid)}`} target="_blank" rel="noopener">📎 {a.name}</a>{/if}{/each}
              {#if m.text.replace(/￼/g, '').trim()}<p>{m.text.replace(/￼/g, '')}</p>{/if}
              {#if m.error}<small class="who">Not delivered{#if m.fromMe && !open.group} · <button class="retry" disabled={Boolean(retrying)} onclick={() => retrySms(m)}>{retrying === m.guid ? 'Sending…' : 'Retry as SMS'}</button>{/if}</small>{/if}
              {#if data.asana && m.text}<button class="toasana" title="Create an Asana task from this message" onclick={() => toAsana(m)}>→ Asana</button>{/if}
            </div>
          {/each}
        </div>
        {#if suggestion}<div class="suggest">✦ {suggestion.category}{suggestion.template ? ` · template “${templates.find((t) => t.id === suggestion?.template)?.title}”` : ' · AI draft'} — {suggestion.why} <span class="muted">Review, edit, then Send.</span> <button class="link" onclick={() => (suggestion = null)}>✕</button></div>{/if}
        <div class="replybar">
          <select aria-label="Canned reply" onchange={(e) => { const t = templates.find((x) => x.id === e.currentTarget.value); if (t) draft = t.text; e.currentTarget.value = ''; }}><option value="">Canned replies…</option>{#each templates as t (t.id)}<option value={t.id}>{t.title}</option>{/each}</select>
          {#if data.aiAvailable}<button onclick={suggest} disabled={suggesting} title="AI reads the conversation, picks a matching canned reply or drafts one">✦ {suggesting ? 'Thinking…' : 'Suggest reply'}</button>{/if}
          <button class="link" onclick={() => (managing = true)}>Manage replies</button>
        </div>
        <form class="composer" onsubmit={(e) => { e.preventDefault(); send(); }}><textarea bind:value={draft} rows={draft.includes('\n') || draft.length > 90 ? 6 : 1} placeholder={asSms ? 'Text Message · SMS' : 'iMessage'} onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>{#if oneToOne}<button type="button" class="svc" class:on={asSms} title="Send as iMessage or SMS (click to switch)" onclick={() => open && (smsPick = { ...smsPick, [open.guid]: !asSms })}>{asSms ? 'SMS' : 'iMessage'}</button>{/if}<button class="primary" disabled={sending || !draft.trim()}>Send</button></form>
      {/if}
    </section>
  </div>
  {/if}
  {#if managing}<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) { managing = false; editTpl = null; } }}><div class="sheet"><h3>Canned replies</h3>
    {#each templates as t (t.id)}<div class="tpl"><div class="tplh"><b>{t.title}</b>{#if t.spam ?? t.id === 'stop-solicitation'}<em class="spamtag">→ Spam{(t.report ?? t.id === 'stop-solicitation') ? ' + 7726' : ''}</em>{/if}<span class="sp"></span><button class="link" onclick={() => (editTpl = { ...t, spam: t.spam ?? t.id === 'stop-solicitation', report: t.report ?? t.id === 'stop-solicitation' })}>Edit</button><button class="link danger" onclick={() => deleteTemplate(t.id)}>Delete</button></div><pre>{t.text}</pre></div>{:else}<p class="muted">No canned replies.</p>{/each}
    {#if editTpl}<form class="tplform" onsubmit={(e) => { e.preventDefault(); saveTemplate(); }}><input bind:value={editTpl.title} placeholder="Title" aria-label="Title"><textarea bind:value={editTpl.text} rows="8" placeholder="Reply text"></textarea><label class="chkl"><input type="checkbox" bind:checked={editTpl.spam}> Sending this reply moves the conversation to Spam</label>{#if editTpl.spam}<label class="chkl"><input type="checkbox" checked={editTpl.report ?? editTpl.id === 'stop-solicitation'} onchange={(e) => editTpl && (editTpl.report = e.currentTarget.checked)}> Also report the sender to 7726 (forwards their text, then their number)</label>{/if}<div class="end"><button type="button" onclick={() => (editTpl = null)}>Cancel</button><button class="primary">Save reply</button></div></form>
    {:else}<div class="end"><button onclick={() => (editTpl = { id: '', title: '', text: '' })}>＋ New reply</button><button class="primary" onclick={() => (managing = false)}>Done</button></div>{/if}</div></div>{/if}
  {#if asanaFor}<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) asanaFor = null; }}>
    <form class="sheet" onsubmit={(e) => { e.preventDefault(); createAsana(); }}><h3>Create Asana task</h3>
      {#if asanaFor.busy}<p class="muted">✦ Drafting from the conversation…</p>{:else}{#if asanaFor.note}<small class="ai">{asanaFor.note}</small>{/if}
      <input bind:value={asanaFor.name} aria-label="Title"><label class="rowl">Due <input type="date" bind:value={asanaFor.day}></label><textarea rows="7" bind:value={asanaFor.notes}></textarea>{/if}
      <div class="end"><button type="button" onclick={() => (asanaFor = null)}>Cancel</button><button class="primary" disabled={asanaFor.busy}>Create task</button></div></form></div>{/if}
  {#if ctx}{@const r = ctx.row}<div class="ctxmenu" role="menu" style={`left:${ctx.x}px;top:${ctx.y}px`}>
    {#if isReportRow(r)}<button role="menuitem" onclick={() => { setDone(r, false); ctx = null; }}>🚫 Move back to Spam</button><button role="menuitem" onclick={() => { setSpam(r, false); ctx = null; }}>Not spam</button>
    {:else if isSpamRow(r)}<button role="menuitem" onclick={() => { setDone(r, true); ctx = null; }}>📨 Move to Spam reports</button><button role="menuitem" onclick={() => { setSpam(r, false); ctx = null; }}>Not spam</button>
    {:else}<button role="menuitem" onclick={() => { setSpam(r, true); ctx = null; }}>🚫 Move to Spam</button><button role="menuitem" onclick={() => { setDone(r, true); ctx = null; }}>📨 Move to Spam reports</button>{/if}
  </div>{/if}
</main>
</AppShell>
<svelte:window onclick={() => (ctx = null)} onkeydown={(e) => { if (e.key === 'Escape') ctx = null; }} onscroll={() => (ctx = null)} />

<style>
  main{color:#29344c;font-size:13px}
  .ctxmenu{position:fixed;z-index:50;display:grid;min-width:190px;background:#fff;border:1px solid #dfe4ee;border-radius:10px;box-shadow:0 8px 24px rgba(20,30,60,.16);padding:4px}.ctxmenu button{border:0;background:none;text-align:left;padding:7px 10px;border-radius:7px;font-size:12px;font-weight:600;color:#29344c;cursor:pointer}.ctxmenu button:hover{background:#f1f4fa}
  .empty{background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:22px;max-width:560px;display:grid;gap:8px}.empty h1{margin:0}
  .alert{background:#fff3f3;border:1px solid #f3c9cf;color:#a5414d;border-radius:10px;padding:8px 12px;margin-bottom:8px}.alert.soft{background:#eef1ff;border-color:#cfd8ff;color:#3157de}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:8px}.tilebtn{display:grid;justify-items:start;gap:1px;background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:9px 11px;text-align:left;cursor:pointer}.tilebtn b{font-size:20px;color:#1f2a44}.tilebtn small{color:#6b7690;font-weight:600}.tilebtn.on{border-color:#2f7cf6;box-shadow:0 0 0 2px #dbe8ff}.tilebtn.zero{opacity:.55}.tilebtn.spam b{color:#8a95a8}.chkl{display:flex;gap:6px;align-items:center;font-size:12px;color:#53607a}.spamtag{font-style:normal;font-size:10px;font-weight:800;color:#b53c50;background:#fdeceb;border-radius:5px;padding:1px 6px}.tilebtn.unknown b{color:#c0392b}.tilebtn.personal b{color:#1e8a4c}.tilebtn.health b{color:#239aa5}
  .statusbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:12px;color:#8a95a8;margin-bottom:8px}.statusbar .on{color:#2a9d5c}.statusbar a{color:#3157de;font-weight:600}.sp{flex:1}.err{color:#a5414d}
  .replybar{display:flex;gap:8px;align-items:center;padding:6px 10px 0;flex-wrap:wrap}.replybar select{border:1px solid #d9dfeb;border-radius:8px;padding:5px 8px;font:inherit;font-size:12px}
  .suggest{margin:0 10px;padding:6px 10px;background:#faf7ff;border:1px solid #ece3ff;border-radius:8px;font-size:12px;color:#6a3fd6}
  .tpl{border-top:1px solid #f0f2f7;padding:8px 0}.tplh{display:flex;gap:10px;align-items:center}.tpl pre{white-space:pre-wrap;font:12px/1.45 system-ui,sans-serif;color:#53607a;margin:4px 0 0}.tplform{display:grid;gap:8px;border-top:1px solid #f0f2f7;padding-top:10px}.danger{color:#b53c50}
  .wrap{display:grid;grid-template-columns:320px minmax(0,1fr);gap:12px;height:calc(100vh - 120px)}
  .list,.thread{background:#fff;border:1px solid #e4e9f2;border-radius:14px;display:flex;flex-direction:column;min-height:0;overflow:hidden}
  .lhead{display:flex;gap:6px;padding:10px}.lhead input{flex:1}
  input,textarea{border:1px solid #d9dfeb;border-radius:9px;padding:7px 9px;font:inherit;min-width:0}textarea{resize:none}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:6px 11px;font-weight:700;color:#43516c;cursor:pointer;font-size:12px}button:disabled{opacity:.5}
  .primary{background:#2f7cf6;border-color:#2f7cf6;color:#fff;text-decoration:none;border-radius:8px;padding:7px 14px;font-weight:700;justify-self:start}.link{border:0;background:none;color:#3157de;padding:0}
  .new{font-size:15px}.status{padding:0 12px 6px;color:#8a95a8}.status.on{color:#2a9d5c}
  .compose{display:grid;gap:6px;padding:0 10px 10px}
  ul{list-style:none;margin:0;padding:0;overflow:auto}
  .chat{display:flex;gap:10px;align-items:center;width:100%;border:0;border-radius:0;border-top:1px solid #f1f3f7;padding:10px 12px;text-align:left;background:#fff;font-weight:500}.chat:hover{background:#f7f8fb}.chat.on{background:#eef3ff}
  .av{width:38px;height:38px;border-radius:50%;background:#e7ecf6;color:#53607a;display:grid;place-items:center;font-weight:800;flex:none}.av.grp{background:#eaf7ef}
  .meta{display:grid;gap:2px;min-width:0;flex:1}.row1{display:flex;gap:6px;justify-content:space-between}.row1 strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1f2a44}.row1 time{color:#8a95a8;font-size:11px;flex:none}
  .pv{color:#6b7690;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.chat.unread strong,.chat.unread .pv{font-weight:800;color:#1f2a44}
  .sms{font-style:normal;font-size:9px;font-weight:800;background:#e6f6ea;color:#2a8a55;border-radius:4px;padding:1px 4px;margin-left:5px;vertical-align:middle}.await{font-style:normal;font-size:10px;font-weight:700;color:#e8862a}.crow{display:flex;align-items:center;padding-left:6px}.crow input{flex:none}.crow .chat{flex:1}.gcount{font-style:normal;font-size:10px;font-weight:700;color:#6a3fd6}.new.on{background:#eef1ff;border-color:#8da2f0}
  .pickbar{display:flex;gap:8px;align-items:center;padding:0 10px 8px;font-size:12px;font-weight:600}.small{padding:4px 9px;font-size:11px}
  .showall{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:6px;font-size:13px}.showall label{display:flex;gap:6px;align-items:center;font-weight:600}.showall small{color:#8a95a8;font-weight:500}
  .similar{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:8px 12px;margin-bottom:8px;display:grid;gap:6px}.srow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.srow small{color:#8a95a8}
  .hint{margin:0;padding:7px 14px;background:#f4f1ff;border-bottom:1px solid #e6defc;font-size:12px;color:#53607a}.svc{align-self:flex-end;border:1px solid #d6dbe6;background:#fff;color:#2f7cf6;border-radius:8px;padding:4px 8px;font-size:11px;font-weight:800;cursor:pointer}.svc.on{color:#2a8a55;background:#e6f6ea;border-color:#bfe5cb}.retry{border:0;background:#fff;color:#a5414d;border-radius:6px;padding:1px 6px;font-size:10px;font-weight:800;cursor:pointer}.dot{width:9px;height:9px;border-radius:50%;background:#2f7cf6;flex:none}
  .thread header{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid #eef0f5}.thread header div{display:grid;flex:1;min-width:0}.thread header small{color:#8a95a8}.back{display:none}
  .summary{display:flex;gap:8px;background:#faf7ff;border-bottom:1px solid #ece3ff;padding:8px 14px}.summary pre{margin:0;flex:1;white-space:pre-wrap;font:12px/1.5 system-ui,sans-serif}
  .msgs{flex:1;overflow:auto;padding:12px 16px;display:flex;flex-direction:column;gap:4px}
  .ts{align-self:center;color:#8a95a8;font-size:11px;margin:8px 0 2px}
  .bubble{position:relative;max-width:70%;align-self:flex-start;background:#eceef2;border-radius:16px;padding:7px 11px;display:grid;gap:4px}.bubble.me{align-self:flex-end;background:#2f7cf6;color:#fff}.bubble.err{background:#fdeceb;color:#a5414d}
  .bubble p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.4}.bubble img{max-width:240px;max-height:240px;border-radius:10px;display:block}
  .who{font-size:10px;font-weight:700;opacity:.75}.file{color:inherit;font-weight:600}
  .toasana{position:absolute;top:-10px;right:-6px;display:none;padding:2px 7px;font-size:10px;border-radius:999px;background:#fdeeee;border-color:#f5c9cb;color:#d2474c}.bubble:hover .toasana{display:block}
  .composer{display:flex;gap:8px;padding:10px;border-top:1px solid #eef0f5}.composer textarea{flex:1;border-radius:18px;padding:8px 12px}
  .pad{padding:14px}.muted{color:#8a95a8}
  .backdrop{position:fixed;inset:0;background:#151c2d55;z-index:60;display:grid;place-items:start center;padding:8vh 16px}.sheet{background:#fff;border-radius:14px;padding:18px;width:min(520px,100%);display:grid;gap:9px}.sheet h3{margin:0}.ai{color:#6a3fd6;font-weight:600}.rowl{display:flex;gap:6px;align-items:center;color:#53607a;font-weight:600}.end{display:flex;gap:8px;justify-content:flex-end}
  @media(max-width:800px){.wrap{grid-template-columns:1fr;height:auto}.wrap.reading .list{display:none}.wrap:not(.reading) .thread{display:none}.back{display:block}.thread{height:calc(100vh - 120px)}}
</style>
