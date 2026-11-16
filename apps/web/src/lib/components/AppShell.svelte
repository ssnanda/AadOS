<script lang="ts">
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import SyncProgress from './SyncProgress.svelte';
  import { purgeAndSync, startFullSync } from '$lib/sync';
  import type { Snippet } from 'svelte';
  let { title, children }: { title: string; children: Snippet } = $props();
  let open = $state(false);
  let syncing = $state(false);
  let syncNote = $state('');
  async function syncAll() {
    syncing = true; syncNote = '';
    try { const r = await fetch('/sync', { method: 'POST' }); const d = await r.json(); syncNote = r.ok ? `+${d.added}${d.failed ? ` · ${d.failed} failed` : ''}` : 'Sync failed'; await invalidateAll(); }
    catch { syncNote = 'Sync failed'; }
    syncing = false;
  }
  const tone = (parser: string) => parser === 'shop' ? 'pink' : parser === 'health' ? 'teal' : 'blue';
  let views = $derived((page.data.shell?.views ?? []) as { id: string; name: string; parser: string; count: number }[]);
  const here = (path: string) => path === '/' ? page.url.pathname === '/' : page.url.pathname === path;
  const icon = (parser: string) => parser === 'shop' ? '🛍' : parser === 'health' ? '♡' : '✉';
</script>
<div class="workspace">
  <aside class:expanded={open} class="sidebar" aria-label="Primary navigation">
    <a class="brand" href="/"><span class="mark">a</span><span>Aad<span class="os">OS</span><small>PERSONAL OS</small></span></a>
    <a class="nav violet" class:active={here('/')} href="/"><span>▦</span>Dashboard</a>
    <a class="nav blue" class:active={here('/emails')} href="/emails"><span>✉</span>Emails</a>
    <a class="nav teal" class:active={here('/tasks')} href="/tasks"><span>☑</span>Tasks</a>
    {#if views.length}<div class="heading">VIEWS</div>{#each views as v (v.id)}<a class="nav sub {tone(v.parser)}" class:active={page.url.pathname === `/pipelines/${v.id}`} href={`/pipelines/${v.id}`}><span>{icon(v.parser)}</span>{v.name}<b>{v.count}</b></a>{/each}{/if}
    <small class="ver">v{__APP_VERSION__}</small>
  </aside>
  <main class="main">
    <header class="topbar"><button class="menu" onclick={() => open = !open} aria-label="Toggle navigation">☰</button><strong>{title}</strong><form class="search" method="GET" action="/search" role="search"><span>⌕</span><input type="search" name="q" placeholder="Search all emails…" value={page.url.pathname === '/search' ? page.url.searchParams.get('q') ?? '' : ''} aria-label="Search all emails"></form><div class="actions">{#if syncNote}<small>{syncNote}</small>{/if}<button class="btn full" onclick={() => startFullSync()} title="Fetch every email in every view, in the background">⇩ Sync all emails</button><button class="btn purge" onclick={async () => { if (await purgeAndSync()) await invalidateAll(); }} title="Delete all stored emails, then re-sync everything">⌫ Purge &amp; sync</button><button class="btn sync" onclick={syncAll} disabled={syncing}><span class:spin={syncing}>⟳</span>{syncing ? 'Syncing…' : 'Sync'}</button><a class="btn cfg" class:on={page.url.pathname.startsWith('/settings')} href="/settings">⚙ Settings</a><form method="POST" action="/logout"><button class="btn out" type="submit">Sign out</button></form></div></header>
    <div class="content">{@render children()}</div>
  </main>
<SyncProgress />
</div>
<style>
  .workspace{display:flex;min-height:100vh;color:#283044}
  .ver{margin-top:auto;padding:12px 10px 0;color:#8a95a8;font-size:11px;font-weight:600}
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
  .heading{padding:16px 12px 6px;color:#a3adbf;font-size:10px;font-weight:750;letter-spacing:1.3px}
  .main{flex:1;min-width:0}
  .topbar{height:62px;background:#fff;border-bottom:1px solid #e9ecf4;display:flex;align-items:center;gap:12px;padding:0 32px}
  .topbar strong{color:#3e4860}.search{display:flex;align-items:center;gap:8px;flex:1;max-width:420px;background:#f4f6fb;border:1px solid #e6eaf3;border-radius:10px;padding:0 12px;margin:0 12px}.search:focus-within{border-color:#8da2f0;background:#fff}.search span{color:#8a95a8;font-size:18px}.search input{border:0;outline:0;background:transparent;flex:1;min-width:0;padding:9px 0;font-size:13px;color:#29344c;font-family:inherit}.actions{margin-left:auto;display:flex;align-items:center;gap:8px}.actions form{margin:0}.actions small{color:#139488;font-weight:700;font-size:12px}
  .btn{display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:9px;padding:8px 14px;font-size:12px;font-weight:700;text-decoration:none;cursor:pointer;font-family:inherit}
  .sync{background:#e3f6f3;color:#0f7f74}.sync:hover{background:#cdeee9}.sync:disabled{opacity:.7;cursor:wait}
  .cfg{background:#f1ebff;color:#6a3fd1}.cfg:hover,.cfg.on{background:#6a3fd1;color:#fff}
  .out{background:#fff0f1;color:#c24457}.out:hover{background:#c24457;color:#fff}
  .purge{background:#fff0f1;color:#c24457}.purge:hover{background:#c24457;color:#fff}
  .full{background:#fff4df;color:#a1752a}.full:hover{background:#f6e0b0}
  .spin{display:inline-block;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
  .content{max-width:2200px;margin:auto;padding:32px}
  .menu{display:none;border:0;background:transparent;color:#4b5e86;font-size:19px}
  @media(max-width:900px){.sidebar{position:fixed;z-index:20;transform:translateX(-100%);transition:transform .2s;height:100%}.sidebar.expanded{transform:none;box-shadow:10px 0 25px #151c2d18}.menu{display:inline-block}.topbar{padding:0 16px}.content{padding:20px 14px}.topbar strong{display:none}.search{margin:0}}
</style>
