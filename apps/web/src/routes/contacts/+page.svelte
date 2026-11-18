<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import AppShell from '$lib/components/AppShell.svelte';
  import { prettyAddress, type MsgGroup } from '$lib/messages-model';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  type Person = (typeof data.people)[number];
  let q = $state(''), sel = $state<Person | null>(null), detail = $state<{ mails: any[]; chats: any[] } | null>(null), loading = $state(false), notice = $state('');
  let groups = $state<MsgGroup[]>([]), letter = $state('');
  $effect(() => { groups = data.groups; });
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9@.+]/g, '');
  const shown = $derived.by(() => {
    const t = norm(q), digits = q.replace(/\D/g, '');
    return data.people.filter((p) => (!letter || p.name.toUpperCase().startsWith(letter)) && (!t || norm(p.name).includes(t) || p.emails.some((e) => e.toLowerCase().includes(q.toLowerCase())) || (digits.length >= 3 && p.phones.some((ph) => ph.replace(/\D/g, '').includes(digits))))).slice(0, 400);
  });
  const letters = $derived([...new Set(data.people.map((p) => p.name[0]?.toUpperCase()).filter((c) => c && /[A-Z]/.test(c)))].sort());
  async function api(op: string, payload: Record<string, unknown> = {}) {
    const res = await fetch('/contacts/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, ...payload }) });
    const b = await res.json().catch(() => ({})); if (!res.ok || b.error) throw new Error(b.error || `HTTP ${res.status}`); return b;
  }
  async function open(p: Person) { sel = p; detail = null; loading = true; try { detail = await api('detail', { emails: p.emails, phones: p.phones }); } catch (e) { notice = (e as Error).message; } finally { loading = false; } }
  const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const when = (v: string | number) => new Date(v).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  async function refresh() { await api('refresh'); await invalidateAll(); }
</script>

<svelte:head><title>Contacts · AadOS</title></svelte:head>
<AppShell title="Contacts">
<main>
  <header class="head"><h1>Contacts</h1><small class="muted">{data.people.length.toLocaleString()} from Google Contacts{data.accounts.length ? ` (${data.accounts.join(', ')})` : ''} · read-only</small><span class="sp"></span><button onclick={refresh}>↻ Refresh</button></header>
  {#if !data.contactsOn}<div class="alert">Google Contacts is off. {#if data.owner}<a href="/settings/emails">Tick “Contacts” on a Gmail account in Settings → Emails &amp; Calendar</a>.{:else}Ask the owner to turn it on.{/if}</div>{/if}
  {#each data.errors as e (e)}<div class="alert">{e}</div>{/each}
  {#if notice}<div class="alert">{notice}</div>{/if}
  <div class="wrap" class:reading={Boolean(sel)}>
    <section class="list">
      <input type="search" bind:value={q} placeholder="Search name, email or number" aria-label="Search contacts">
      <div class="letters"><button class:on={!letter} onclick={() => (letter = '')}>All</button>{#each letters as l (l)}<button class:on={letter === l} onclick={() => (letter = letter === l ? '' : l)}>{l}</button>{/each}</div>
      <ul>{#each shown as p (p.name + p.phones.join() + p.emails.join())}<li><button class:on={sel === p} onclick={() => open(p)}><span class="av">{initials(p.name)}</span><span class="meta"><b>{p.name}</b><small>{p.phones[0] ? prettyAddress(p.phones[0]) : p.emails[0] || ''}</small></span></button></li>{:else}<li class="muted pad">No contacts match.</li>{/each}</ul>
      {#if shown.length === 400}<small class="muted pad">Showing the first 400 — search to narrow.</small>{/if}
    </section>
    <section class="pane">
      {#if sel}
        <header><button class="back" onclick={() => (sel = null)}>‹</button><span class="av big">{initials(sel.name)}</span><div><h2>{sel.name}</h2><small class="muted">{sel.sources.join(' · ')}</small></div></header>
        <div class="kv">{#each sel.phones as ph (ph)}<div class="line"><span>📱 {prettyAddress(ph)}</span><a class="btn" href={`/messages?to=${encodeURIComponent(ph)}`}>Message</a><a class="btn ghost" href={`tel:${ph}`}>Call</a></div>{/each}
          {#each sel.emails as em (em)}<div class="line"><span>✉ {em}</span><a class="btn ghost" href={`mailto:${em}`}>Email</a><a class="btn ghost" href={`/emails?view=all&q=${encodeURIComponent(em)}`}>Find emails</a></div>{/each}</div>
        {#if loading}<p class="muted">Loading recent activity…</p>{:else if detail}
          <h3>Messages</h3>{#each detail.chats as c (c.guid)}<a class="act" href="/messages"><b>{c.title}</b><small>{when(c.at)} · {c.preview}</small></a>{:else}<p class="muted">No iMessage conversations.</p>{/each}
          <h3>Recent emails</h3>{#each detail.mails as m (m.key)}<a class="act" href={`/emails?view=all&q=${encodeURIComponent(m.subject)}`}><b>{m.subject || '(no subject)'}</b><small>{when(m.at)} · {m.account}</small></a>{:else}<p class="muted">No emails from this contact in AadOS.</p>{/each}
        {/if}
      {:else}<p class="muted pad">Pick a contact.</p>{/if}
      <h3 class="gh">Sender groups <small class="muted">(several numbers shown as one contact in Messages)</small></h3>
      {#each groups as g (g.id)}<div class="grp"><div class="line"><b>🏷 {g.name}</b><span class="sp"></span><button class="link" onclick={async () => { const n = prompt('Rename group', g.name); if (n) groups = (await api('group.rename', { id: g.id, name: n })).groups; }}>Rename</button><button class="link danger" onclick={async () => { if (confirm(`Delete “${g.name}”? The conversations go back to separate rows.`)) groups = (await api('group.delete', { id: g.id })).groups; }}>Delete</button></div>
        <div class="chips">{#each g.addresses as a (a)}<span class="chip">{prettyAddress(a)}<button class="x" title="Remove from group" onclick={async () => (groups = (await api('group.removeAddress', { id: g.id, address: a })).groups)}>✕</button></span>{/each}</div></div>{:else}<p class="muted">None yet — create them from Messages (🏷 Name sender, ☑ select, or Find similar).</p>{/each}
    </section>
  </div>
</main>
</AppShell>

<style>
  main{color:#29344c;font-size:13px}.head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}h1{margin:0;font-size:22px}h2{margin:0;font-size:18px}h3{margin:14px 0 6px;font-size:12px;text-transform:uppercase;color:#8a95a8}.sp{flex:1}.muted{color:#8a95a8}.pad{padding:12px;display:block}
  .alert{background:#fff8e6;border:1px solid #f3dfa8;color:#8a6a1c;border-radius:9px;padding:8px 12px;margin-bottom:8px}.alert a{color:#3157de;font-weight:600}
  button,.btn{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:5px 10px;font-weight:700;color:#43516c;cursor:pointer;font-size:12px;text-decoration:none}.btn{background:#2f7cf6;border-color:#2f7cf6;color:#fff}.btn.ghost{background:#fff;color:#43516c;border-color:#d9dfeb}.link{border:0;background:none;padding:0;color:#3157de}.danger{color:#b53c50}
  .wrap{display:grid;grid-template-columns:340px minmax(0,1fr);gap:12px;height:calc(100vh - 130px)}.list,.pane{background:#fff;border:1px solid #e4e9f2;border-radius:14px;overflow:auto;min-height:0}.pane{padding:14px}
  .list input{margin:10px;width:calc(100% - 20px);box-sizing:border-box;border:1px solid #d9dfeb;border-radius:9px;padding:8px 10px;font:inherit}
  .letters{display:flex;flex-wrap:wrap;gap:2px;padding:0 10px 6px}.letters button{border:0;padding:2px 5px;font-size:11px;color:#6b7690;background:none}.letters button.on{background:#2f7cf6;color:#fff;border-radius:5px}
  ul{list-style:none;margin:0;padding:0}li button{display:flex;gap:10px;align-items:center;width:100%;border:0;border-top:1px solid #f1f3f7;border-radius:0;padding:8px 12px;background:#fff;text-align:left;font-weight:500}li button:hover{background:#f7f8fb}li button.on{background:#eef3ff}
  .av{width:34px;height:34px;border-radius:50%;background:#e7ecf6;color:#53607a;display:grid;place-items:center;font-weight:800;flex:none;font-size:12px}.av.big{width:48px;height:48px;font-size:16px}.meta{display:grid;min-width:0}.meta b{color:#1f2a44;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta small{color:#8a95a8}
  .pane header{display:flex;gap:12px;align-items:center;margin-bottom:8px}.back{display:none}.kv{display:grid;gap:6px}.line{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.line span{min-width:220px}
  .act{display:grid;gap:2px;padding:7px 9px;border-radius:8px;text-decoration:none;color:#29344c}.act:hover{background:#f4f6fb}.act small{color:#8a95a8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .gh{border-top:1px solid #eef0f5;padding-top:12px;margin-top:18px}.grp{border-bottom:1px solid #f1f3f7;padding:6px 0}.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}.chip{display:inline-flex;gap:4px;align-items:center;background:#f0f2f7;border-radius:999px;padding:2px 4px 2px 9px;font-size:12px}.x{border:0;background:none;padding:0 4px;font-size:11px;color:#8a95a8}
  @media(max-width:800px){.wrap{grid-template-columns:1fr;height:auto}.wrap.reading .list{display:none}.wrap:not(.reading) .pane > header{display:none}.back{display:block}}
</style>
