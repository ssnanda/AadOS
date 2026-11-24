<script lang="ts">
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import SyncProgress from './SyncProgress.svelte';
  import { purgeEmails } from '$lib/sync';
  import { SETTINGS_PAGES } from '$lib/settings-nav';
  import type { Snippet } from 'svelte';
  let { title, children }: { title: string; children: Snippet } = $props();
  let open = $state(false);
  let settingsOpen = $state(false);
  // Dashboard's Views list pinned open (it also opens on hover and on a view page).
  let dashOpen = $state(false);
  // Signed-in user (owner, or a family member limited to the sections the owner allowed).
  const me = $derived(page.data.shell?.user as { name: string; owner: boolean; permissions: string[]; ownAccounts?: boolean } | null | undefined);
  const may = (p: string) => !me || me.owner || me.permissions.includes(p) || (Boolean(me.ownAccounts) && (p === 'emails' || p === 'calendar'));
  // Close the Settings menu on any click outside it, on Escape, and after navigating.
  $effect(() => { void page.url.pathname; settingsOpen = false; open = false; });
  const tone = (parser: string) => parser === 'shop' ? 'pink' : parser === 'health' ? 'teal' : 'blue';
  let views = $derived((page.data.shell?.views ?? []) as { id: string; name: string; parser: string; count: number; total: number }[]);
  let accounts = $derived((page.data.shell?.accounts ?? []) as { id: string; provider: string; email: string; unread: number; folders: { id: string; name: string; total: number; unread: number }[] }[]);
  // Email mode (/emails): unread by default, only inboxes with unread mail; "All" shows every inbox and message.
  // View mode (/pipelines/<id>): custom views always show all their emails.
  const inEmails = $derived(page.url.pathname === '/emails');
  const currentAccount = $derived(inEmails ? page.url.searchParams.get('account') || '' : null);
  const mailAll = $derived(inEmails && page.url.searchParams.get('view') === 'all');
  const shownAccounts = $derived(mailAll ? accounts : accounts.filter((a) => a.unread > 0 || a.id === currentAccount));
  const currentFolder = $derived(inEmails ? page.url.searchParams.get('folder') || '' : '');
  // Folders with mail for the current mode: unread mail in Unread, any mail in All.
  // All view: every folder; Unread view: folders with unread mail.
  const foldersOf = (a: (typeof accounts)[number]) => a.folders.filter((f) => mailAll || f.unread > 0);
  const mailHref = (account: string, all = mailAll, folder = '') => { const q = new URLSearchParams(); if (account) q.set('account', account); if (folder) q.set('folder', folder); if (all) q.set('view', 'all'); const s = q.toString(); return s ? `/emails?${s}` : '/emails'; };
  const totalUnread = $derived(accounts.reduce((n, a) => n + a.unread, 0));
  // Count badges for Calendar / Conference Room (Asana, Finance, Documents stream in via page.data.navCounts).
  const counts = $derived((page.data.shell?.counts ?? { calendar: 0, room: 0 }) as { calendar: number; room: number });
  // Report the browser's time zone once, so calendar days match the owner's clock.
  $effect(() => {
    if (page.data.shell && page.data.shell.timeZone === '') {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) fetch('/settings/timezone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tz }) }).then((r) => { if (r.ok) invalidateAll(); }).catch(() => undefined);
    }
  });
  const onView = $derived(page.url.pathname.startsWith('/pipelines/'));
  const here = (path: string) => path === '/' ? page.url.pathname === '/' : page.url.pathname === path;
  const icon = (parser: string) => parser === 'shop' ? '🛍' : parser === 'health' ? '♡' : '✉';
</script>
<svelte:window onclick={(e) => { if (settingsOpen && !(e.target as HTMLElement).closest('.menuwrap')) settingsOpen = false; }} onkeydown={(e) => { if (e.key === 'Escape') settingsOpen = false; }} />
<div class="workspace">
  {#if open}<button class="nav-scrim" aria-label="Close navigation" onclick={() => open = false}></button>{/if}
  <aside class:expanded={open} class="sidebar" aria-label="Primary navigation">
    <a class="brand" href="/"><span class="mark">a</span><span>Aad<span class="os">OS</span><small>PERSONAL OS</small></span></a>
    <!-- Views live inside Dashboard: shown on hover, when the arrow pins them open, or while a view is open. -->
    <div class="dash" class:open={dashOpen || onView}>
      <div class="dashrow"><a class="nav violet" class:active={here('/')} href="/"><span>▦</span>Dashboard</a>{#if views.length}<button type="button" class="caret" aria-label={dashOpen ? 'Hide views' : 'Show views'} aria-expanded={dashOpen || onView} onclick={() => dashOpen = !dashOpen}>▾</button>{/if}</div>
      {#if views.length}<div class="subviews" aria-label="Views">{#each views as v (v.id)}<a class="nav sub {tone(v.parser)}" class:active={page.url.pathname === `/pipelines/${v.id}`} href={`/pipelines/${v.id}`}><span>{icon(v.parser)}</span>{v.name}</a>{/each}</div>{/if}
    </div>
    {#if may('asana')}<a class="nav pink" class:active={here('/asana')} href="/asana"><span>◉</span>Asana{#await page.data.navCounts then c}{#if c?.asana}<b title="Overdue or due today">{c.asana}</b>{/if}{/await}</a>{/if}
    {#if may('finance')}<a class="nav teal" class:active={page.url.pathname.startsWith('/finance')} href="/finance"><span>$</span>Finance{#await page.data.navCounts then c}{#if c?.finance}<b title="Alerts in the last 24 hours">{c.finance}</b>{/if}{/await}</a>{/if}{#if may('calendar')}<a class="nav pink" class:active={here('/calendar')} href="/calendar"><span>▣</span>Calendar{#if counts.calendar}<b title="Events left today">{counts.calendar}</b>{/if}</a>{/if}{#if may('calendar')}<a class="nav pink" class:active={page.url.pathname.startsWith('/room')} href="/room"><span>🏢</span>Conference Room{#if counts.room}<b title="Room bookings left today">{counts.room}</b>{/if}</a>{/if}
    {#if may('assistant')}<a class="nav blue" class:active={page.url.pathname.startsWith('/assistant')} href="/assistant"><span>✦</span>AI Assistant</a>{/if}
    {#if may('documents')}<a class="nav teal" class:active={page.url.pathname.startsWith('/documents')} href="/documents"><span>▤</span>Documents{#await page.data.navCounts then c}{#if c?.documents}<b title="Added in the last 7 days">{c.documents}</b>{/if}{/await}</a>{/if}
    {#if may('emails')}<a class="nav blue" class:active={here('/emails')} href="/emails"><span>✉</span>Emails{#if !inEmails && totalUnread}<b>{totalUnread}</b>{/if}</a>{/if}
    {#if inEmails && accounts.length}<div class="inboxes" aria-label="Inboxes"><div class="mode" role="group" aria-label="Show"><a class:on={!mailAll} href={mailHref(currentAccount || '', false, currentFolder)}>Unread</a><a class:on={mailAll} href={mailHref(currentAccount || '', true, currentFolder)}>All</a></div><a class="ibx" class:on={currentAccount === ''} href={mailHref('')}>All inboxes{#if totalUnread}<b>{totalUnread}</b>{/if}</a>{#each shownAccounts as a (a.id)}<a class="ibx" class:on={currentAccount === a.id && !currentFolder} href={mailHref(a.id)} title={a.email}><i class={a.provider}>{a.provider === 'gmail' ? 'G' : 'Z'}</i><span>{a.email}</span>{#if a.unread}<b>{a.unread}</b>{/if}</a>{#each foldersOf(a) as f (f.id)}<a class="ibx fld" class:on={currentAccount === a.id && currentFolder === f.id} href={mailHref(a.id, mailAll, f.id)} title={`${f.name} · ${f.unread} unread of ${f.total}`}><span>{f.name.replace(/^inbox\//i, '')}</span>{#if mailAll ? f.total : f.unread}<b>{mailAll ? f.total : f.unread}</b>{/if}</a>{/each}{/each}{#if !shownAccounts.length}<small class="none">No unread mail</small>{/if}</div>{/if}
    {#if may('emails') && accounts.some((a) => a.provider === 'zoho')}<a class="nav blue sub" class:active={page.url.pathname.startsWith('/emails/shared')} href="/emails/shared"><span>👥</span>Shared mailboxes</a>{/if}{#if may('messages')}<a class="nav blue" class:active={page.url.pathname.startsWith('/messages')} href="/messages"><span>💬</span>Messages{#if Number(page.data.shell?.messages) > 0}<b class="mcount">{page.data.shell.messages}</b>{/if}</a>{/if}{#if may('contacts')}<a class="nav violet" class:active={page.url.pathname.startsWith('/contacts')} href="/contacts"><span>👤</span>Contacts</a>{/if}
  </aside>
  <main class="main">
    <header class="topbar"><button class="menu" onclick={() => open = !open} aria-label="Toggle navigation" aria-expanded={open}>☰</button><strong>{title}</strong><form class="search" method="GET" action="/search" role="search"><span>⌕</span><input type="search" name="q" placeholder="Search all emails…" value={page.url.pathname === '/search' ? page.url.searchParams.get('q') ?? '' : ''} aria-label="Search all emails"></form><div class="actions"><small class="ver" title="AadOS version">v{__APP_VERSION__}</small>{#if me?.owner !== false}<button class="btn purge" onclick={async () => { if (await purgeEmails()) await invalidateAll(); }} title="Clears the email copies stored in AadOS. Your Gmail/Zoho mailboxes are not touched; open folders re-sync automatically. Messages, calendar and finance are not affected.">⌫ <span class="btn-label">Purge emails</span></button>{/if}{#if me?.owner !== false}<div class="menuwrap"><button class="btn cfg" class:on={page.url.pathname.startsWith('/settings') || settingsOpen} aria-label="Settings" aria-haspopup="menu" aria-expanded={settingsOpen} onclick={() => (settingsOpen = !settingsOpen)}>⚙ <span class="btn-label">Settings ▾</span></button>{#if settingsOpen}<div class="smenu" role="menu">{#each SETTINGS_PAGES as s (s.href)}<a role="menuitem" href={s.href} class:cur={page.url.pathname === s.href}><span>{s.icon}</span>{s.label}</a>{/each}<hr><a role="menuitem" href="/asana" class:cur={page.url.pathname === '/asana'}><span>◉</span>Asana connection</a></div>{/if}</div>{:else}{#if me?.ownAccounts}<a class="btn cfg" class:on={page.url.pathname.startsWith('/me')} href="/me/accounts">⚙ <span class="btn-label">My accounts</span></a>{/if}<small class="who">{me?.name}</small>{/if}<form method="POST" action="/logout"><button class="btn out" type="submit"><span class="wide-label">Sign out</span><span class="short-label" aria-hidden="true">↪</span></button></form></div></header>
    <div class="content">{@render children()}</div>
  </main>
<SyncProgress />
</div>
<style>
  .workspace{display:flex;min-height:100vh;color:#283044}
  .nav-scrim{display:none}
  .actions small.ver{color:#8a95a8;font-weight:600;font-size:11px}
  .sidebar{width:230px;flex:none;background:#fff;border-right:1px solid #e9ecf4;display:flex;flex-direction:column;padding:28px 14px 18px;gap:3px;min-height:100vh}
  .brand{display:flex;align-items:center;gap:11px;padding:0 10px 26px;font-weight:780;font-size:23px;letter-spacing:-1.3px;line-height:1;color:inherit;text-decoration:none}
  .mark{height:35px;width:35px;display:grid;place-items:center;background:linear-gradient(135deg,#3157de,#8b5cf6);color:#fff;border-radius:11px;font-size:23px}
  .os{color:#6d5ce8}.brand small{display:block;color:#929bb2;letter-spacing:2px;font-size:8px;margin-top:6px;font-weight:700}
  .nav{--c:#3157de;--bg:#edf1ff;display:flex;gap:11px;align-items:center;height:40px;padding:0 12px;border-radius:9px;color:#56627c;font-size:13px;font-weight:650;text-decoration:none}
  .nav span{width:26px;height:26px;display:grid;place-items:center;border-radius:8px;background:var(--bg);color:var(--c);font-size:14px}
  .nav:hover{background:#f6f7fb}.nav.active{background:var(--bg);color:var(--c)}.nav.active span{background:var(--c);color:#fff}
  .violet{--c:#7c4dde;--bg:#f1ebff}.blue{--c:#2f6fe4;--bg:#e8f1ff}.pink{--c:#d6477f;--bg:#ffedf4}.teal{--c:#139488;--bg:#e3f6f3}
  .nav b{margin-left:auto;font-size:10px;background:var(--bg);border-radius:6px;padding:3px 7px;color:var(--c)}
  .nav.sub{height:36px;font-size:12px}.nav.sub span{width:22px;height:22px;font-size:12px}
  .inboxes{display:grid;gap:1px;margin:2px 0 6px 24px;padding-left:8px;border-left:1px solid #e9ecf4}
  .ibx{display:flex;align-items:center;gap:7px;height:30px;padding:0 8px;border-radius:7px;color:#56627c;font-size:12px;font-weight:600;text-decoration:none;min-width:0}.ibx:hover{background:#f6f7fb}.ibx.on{background:#e8f1ff;color:#2f6fe4}
  .ibx span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}.ibx i{font-style:normal;width:18px;height:18px;flex:none;display:grid;place-items:center;border-radius:5px;font-size:10px;font-weight:800;background:#eef1ff;color:#3157de}.ibx i.gmail{background:#fff0ee;color:#d94d43}
  .ibx b{margin-left:auto;font-size:10px;background:#e8f1ff;border-radius:6px;padding:2px 6px;color:#2f6fe4}
  .mode{display:flex;gap:2px;margin:0 0 3px;padding:2px;background:#f2f4f9;border-radius:8px}.mode a{flex:1;text-align:center;padding:4px 0;border-radius:6px;font-size:11px;font-weight:700;color:#6b778f;text-decoration:none}.mode a.on{background:#fff;color:#2f6fe4;box-shadow:0 1px 2px #0000001a}
  .ibx.fld{height:26px;padding-left:33px;font-weight:500;font-size:11.5px}.ibx.fld b{background:#f0f2f7;color:#5b6a86}
  .subviews{display:none;gap:1px;margin:0 0 6px 24px;padding-left:8px;border-left:1px solid #e9ecf4}.dash:hover .subviews,.dash:focus-within .subviews,.dash.open .subviews{display:grid}
  .dashrow{position:relative}.caret{position:absolute;right:6px;top:7px;width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:#8a95a8;font-size:13px;cursor:pointer;transition:transform .15s}.caret:hover{background:#f1ebff;color:#7c4dde}.dash:not(.open) .caret{transform:rotate(-90deg)}.subviews .nav.sub{height:32px;padding:0 8px}
  .none{padding:4px 8px;color:#8a95a8;font-size:11px}
  .main{flex:1;min-width:0}
  .topbar{height:62px;background:#fff;border-bottom:1px solid #e9ecf4;display:flex;align-items:center;gap:12px;padding:0 32px}
  .topbar strong{color:#3e4860}.search{display:flex;align-items:center;gap:8px;flex:1;max-width:420px;background:#f4f6fb;border:1px solid #e6eaf3;border-radius:10px;padding:0 12px;margin:0 12px}.search:focus-within{border-color:#8da2f0;background:#fff}.search span{color:#8a95a8;font-size:18px}.search input{border:0;outline:0;background:transparent;flex:1;min-width:0;padding:9px 0;font-size:13px;color:#29344c;font-family:inherit}.actions{margin-left:auto;display:flex;align-items:center;gap:8px}.actions form{margin:0}.actions small{color:#139488;font-weight:700;font-size:12px}
  .btn{display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:9px;padding:8px 14px;font-size:12px;font-weight:700;text-decoration:none;cursor:pointer;font-family:inherit}
  .cfg{background:#f1ebff;color:#6a3fd1}.cfg:hover,.cfg.on{background:#6a3fd1;color:#fff}
  .menuwrap{position:relative}.nav.sub{padding-left:28px;font-size:13px}.mcount{margin-left:auto;background:#2f7cf6;color:#fff;border-radius:999px;font-size:11px;padding:1px 8px}.who{color:#6a3fd1;font-weight:700}.smenu{position:absolute;right:0;top:calc(100% + 6px);z-index:80;min-width:200px;background:#fff;border:1px solid #e4e9f2;border-radius:12px;box-shadow:0 12px 30px #151c2d26;padding:6px;display:grid}
  .smenu a{display:flex;gap:9px;align-items:center;padding:8px 10px;border-radius:8px;color:#29344c;text-decoration:none;font-size:13px;font-weight:600}.smenu a span{width:18px;text-align:center;color:#6a3fd1}.smenu a:hover{background:#f4f1ff}.smenu a.cur{background:#f1ebff;color:#6a3fd1}.smenu hr{border:0;border-top:1px solid #eef0f5;margin:4px 0}
  .out{background:#fff0f1;color:#c24457}.out:hover{background:#c24457;color:#fff}
  .purge{background:#fff0f1;color:#c24457}.purge:hover{background:#c24457;color:#fff}
  .content{max-width:2200px;margin:auto;padding:32px}
  .menu{display:none;border:0;background:transparent;color:#4b5e86;font-size:19px}
  .short-label{display:none}
  @media(max-width:900px){.sidebar{position:fixed;z-index:60;transform:translateX(-100%);transition:transform .2s;height:100%;max-height:100dvh;overflow-y:auto;overscroll-behavior:contain}.sidebar.expanded{transform:none;box-shadow:10px 0 25px #151c2d18}.nav-scrim{display:block;position:fixed;inset:0;z-index:59;border:0;background:#151c2d66}.menu{display:inline-grid;place-items:center;min-width:40px;min-height:40px}.topbar{padding:0 12px;position:sticky;top:0;z-index:40}.content{padding:20px 14px}.topbar strong{display:none}.search{margin:0}.purge,.ver{display:none!important}}
  @media(max-width:600px){.topbar{gap:7px;height:56px}.search{padding:0 9px;min-width:0}.search input{font-size:16px}.search input::placeholder{color:transparent}.actions{gap:5px}.btn{min-width:40px;min-height:40px;justify-content:center;padding:8px 10px;font-size:14px}.btn-label,.wide-label,.who{display:none}.short-label{display:inline}.smenu{position:fixed;left:10px;right:10px;top:58px;max-height:calc(100dvh - 68px);overflow-y:auto}.content{padding:14px 10px 24px}}
</style>
