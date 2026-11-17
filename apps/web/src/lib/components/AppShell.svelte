<script lang="ts">
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import SyncProgress from './SyncProgress.svelte';
  import ReminderNotifier from './ReminderNotifier.svelte';
  import { purgeEmails } from '$lib/sync';
  import type { Snippet } from 'svelte';
  let { title, children }: { title: string; children: Snippet } = $props();
  let open = $state(false);
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
  const foldersOf = (a: (typeof accounts)[number]) => a.folders.filter((f) => (mailAll ? f.total : f.unread) > 0);
  const mailHref = (account: string, all = mailAll, folder = '') => { const q = new URLSearchParams(); if (account) q.set('account', account); if (folder) q.set('folder', folder); if (all) q.set('view', 'all'); const s = q.toString(); return s ? `/emails?${s}` : '/emails'; };
  const totalUnread = $derived(accounts.reduce((n, a) => n + a.unread, 0));
  let notifications = $derived(Number(page.data.shell?.notifications ?? 0));
  // Report the browser's time zone once, so server-side reminders and calendar days match the owner's clock.
  $effect(() => {
    if (page.data.shell && page.data.shell.timeZone === '') {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) fetch('/settings/timezone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tz }) }).then((r) => { if (r.ok) invalidateAll(); }).catch(() => undefined);
    }
  });
  const here = (path: string) => path === '/' ? page.url.pathname === '/' : page.url.pathname === path;
  const icon = (parser: string) => parser === 'shop' ? '🛍' : parser === 'health' ? '♡' : '✉';
</script>
<ReminderNotifier enabled={Boolean(page.data.shell?.notifyBrowser)} />
<div class="workspace">
  <aside class:expanded={open} class="sidebar" aria-label="Primary navigation">
    <a class="brand" href="/"><span class="mark">a</span><span>Aad<span class="os">OS</span><small>PERSONAL OS</small></span></a>
    <a class="nav violet" class:active={here('/')} href="/"><span>▦</span>Dashboard</a>
    <a class="nav blue" class:active={here('/emails')} href="/emails"><span>✉</span>Emails{#if !inEmails && totalUnread}<b>{totalUnread}</b>{/if}</a>
    {#if inEmails && accounts.length}<div class="inboxes" aria-label="Inboxes"><div class="mode" role="group" aria-label="Show"><a class:on={!mailAll} href={mailHref(currentAccount || '', false, currentFolder)}>Unread</a><a class:on={mailAll} href={mailHref(currentAccount || '', true, currentFolder)}>All</a></div><a class="ibx" class:on={currentAccount === ''} href={mailHref('')}>All inboxes{#if totalUnread}<b>{totalUnread}</b>{/if}</a>{#each shownAccounts as a (a.id)}<a class="ibx" class:on={currentAccount === a.id && !currentFolder} href={mailHref(a.id)} title={a.email}><i class={a.provider}>{a.provider === 'gmail' ? 'G' : 'Z'}</i><span>{a.email}</span>{#if a.unread}<b>{a.unread}</b>{/if}</a>{#each foldersOf(a) as f (f.id)}<a class="ibx fld" class:on={currentAccount === a.id && currentFolder === f.id} href={mailHref(a.id, mailAll, f.id)} title={`${f.name} · ${f.unread} unread of ${f.total}`}><span>{f.name}</span><b>{mailAll ? f.total : f.unread}</b></a>{/each}{/each}{#if !shownAccounts.length}<small class="none">No unread mail</small>{/if}</div>{/if}
    {#if views.length}<div class="subviews" aria-label="Views"><small>Views</small>{#each views as v (v.id)}<a class="nav sub {tone(v.parser)}" class:active={page.url.pathname === `/pipelines/${v.id}`} href={`/pipelines/${v.id}`} title={`${v.total} emails · ${v.count} unread`}><span>{icon(v.parser)}</span>{v.name}{#if v.total}<b>{v.total}</b>{/if}</a>{/each}</div>{/if}
    <a class="nav teal" class:active={here('/tasks')} href="/tasks"><span>☑</span>Tasks</a>
    <a class="nav pink" class:active={here('/calendar')} href="/calendar"><span>▣</span>Calendar</a>
    <a class="nav blue" class:active={page.url.pathname.startsWith('/assistant')} href="/assistant"><span>✦</span>AI Assistant</a>
    <a class="nav teal" class:active={page.url.pathname.startsWith('/documents')} href="/documents"><span>▤</span>Documents</a>
    <a class="nav violet" class:active={here('/reminders')} href="/reminders"><span>◔</span>Reminders{#if notifications > 0}<b title="Unread notifications">{notifications}</b>{/if}</a>
  </aside>
  <main class="main">
    <header class="topbar"><button class="menu" onclick={() => open = !open} aria-label="Toggle navigation">☰</button><strong>{title}</strong><form class="search" method="GET" action="/search" role="search"><span>⌕</span><input type="search" name="q" placeholder="Search all emails…" value={page.url.pathname === '/search' ? page.url.searchParams.get('q') ?? '' : ''} aria-label="Search all emails"></form><div class="actions"><small class="ver" title="AadOS version">v{__APP_VERSION__}</small><button class="btn purge" onclick={async () => { if (await purgeEmails()) await invalidateAll(); }} title="Delete all emails stored in AadOS (mailboxes unchanged); open folders re-sync automatically">⌫ Purge</button><a class="btn cfg" class:on={page.url.pathname.startsWith('/settings')} href="/settings">⚙ Settings</a><form method="POST" action="/logout"><button class="btn out" type="submit">Sign out</button></form></div></header>
    <div class="content">{@render children()}</div>
  </main>
<SyncProgress />
</div>
<style>
  .workspace{display:flex;min-height:100vh;color:#283044}
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
  .subviews{display:grid;gap:1px;margin:0 0 6px 24px;padding-left:8px;border-left:1px solid #e9ecf4}.subviews small{padding:6px 8px 2px;color:#a3adbf;font-size:10px;font-weight:750;letter-spacing:1.2px;text-transform:uppercase}.subviews .nav.sub{height:32px;padding:0 8px}
  .none{padding:4px 8px;color:#8a95a8;font-size:11px}
  .main{flex:1;min-width:0}
  .topbar{height:62px;background:#fff;border-bottom:1px solid #e9ecf4;display:flex;align-items:center;gap:12px;padding:0 32px}
  .topbar strong{color:#3e4860}.search{display:flex;align-items:center;gap:8px;flex:1;max-width:420px;background:#f4f6fb;border:1px solid #e6eaf3;border-radius:10px;padding:0 12px;margin:0 12px}.search:focus-within{border-color:#8da2f0;background:#fff}.search span{color:#8a95a8;font-size:18px}.search input{border:0;outline:0;background:transparent;flex:1;min-width:0;padding:9px 0;font-size:13px;color:#29344c;font-family:inherit}.actions{margin-left:auto;display:flex;align-items:center;gap:8px}.actions form{margin:0}.actions small{color:#139488;font-weight:700;font-size:12px}
  .btn{display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:9px;padding:8px 14px;font-size:12px;font-weight:700;text-decoration:none;cursor:pointer;font-family:inherit}
  .cfg{background:#f1ebff;color:#6a3fd1}.cfg:hover,.cfg.on{background:#6a3fd1;color:#fff}
  .out{background:#fff0f1;color:#c24457}.out:hover{background:#c24457;color:#fff}
  .purge{background:#fff0f1;color:#c24457}.purge:hover{background:#c24457;color:#fff}
  .content{max-width:2200px;margin:auto;padding:32px}
  .menu{display:none;border:0;background:transparent;color:#4b5e86;font-size:19px}
  @media(max-width:900px){.sidebar{position:fixed;z-index:20;transform:translateX(-100%);transition:transform .2s;height:100%}.sidebar.expanded{transform:none;box-shadow:10px 0 25px #151c2d18}.menu{display:inline-block}.topbar{padding:0 16px}.content{padding:20px 14px}.topbar strong{display:none}.search{margin:0}}
</style>
