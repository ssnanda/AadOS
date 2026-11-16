<script lang="ts">
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';
  let { title, children }: { title: string; children: Snippet } = $props();
  let open = $state(false);
  let views = $derived((page.data.shell?.views ?? []) as { id: string; name: string; parser: string; count: number }[]);
  const here = (path: string) => path === '/' ? page.url.pathname === '/' : page.url.pathname === path;
  const icon = (parser: string) => parser === 'shop' ? '🛍' : parser === 'health' ? '♡' : '✉';
</script>
<div class="workspace">
  <aside class:expanded={open} class="sidebar" aria-label="Primary navigation">
    <a class="brand" href="/"><span class="mark">a</span><span>Aad<span class="os">OS</span><small>PERSONAL OS</small></span></a>
    <a class="nav" class:active={here('/')} href="/"><span>▦</span>Dashboard</a>
    <a class="nav" class:active={here('/emails')} href="/emails"><span>✉</span>Emails</a>
    {#if views.length}<div class="heading">VIEWS</div>{#each views as v (v.id)}<a class="nav sub" class:active={page.url.pathname === `/pipelines/${v.id}`} href={`/pipelines/${v.id}`}><span>{icon(v.parser)}</span>{v.name}<b>{v.count}</b></a>{/each}{/if}
    <a class="nav settings" href="/settings"><span>⚙</span>Settings</a>
  </aside>
  <main class="main">
    <header class="topbar"><button class="menu" onclick={() => open = !open} aria-label="Toggle navigation">☰</button><strong>{title}</strong><form method="POST" action="/logout"><button class="signout" type="submit">Sign out</button></form></header>
    <div class="content">{@render children()}</div>
  </main>
</div>
<style>
  .workspace{display:flex;min-height:100vh;color:#283044}
  .sidebar{width:230px;flex:none;background:#fff;border-right:1px solid #e9ecf4;display:flex;flex-direction:column;padding:28px 14px 18px;gap:3px;min-height:100vh}
  .brand{display:flex;align-items:center;gap:11px;padding:0 10px 26px;font-weight:780;font-size:23px;letter-spacing:-1.3px;line-height:1;color:inherit;text-decoration:none}
  .mark{height:35px;width:35px;display:grid;place-items:center;background:#3157de;color:#fff;border-radius:11px;font-size:23px}
  .os{color:#4264e7}.brand small{display:block;color:#929bb2;letter-spacing:2px;font-size:8px;margin-top:6px;font-weight:700}
  .nav{display:flex;gap:11px;align-items:center;height:40px;padding:0 12px;border-radius:9px;color:#6f7c94;font-size:13px;font-weight:650;text-decoration:none}
  .nav span{width:20px;text-align:center}.nav:hover{background:#f3f5fb}.nav.active{background:#edf1ff;color:#3159dd}
  .nav b{margin-left:auto;font-size:10px;background:#f0f2f7;border-radius:6px;padding:3px 7px;color:#8e98ab}
  .nav.sub{height:34px;font-size:12px;padding-left:22px}
  .heading{padding:16px 12px 6px;color:#a3adbf;font-size:10px;font-weight:750;letter-spacing:1.3px}
  .settings{margin-top:auto}
  .main{flex:1;min-width:0}
  .topbar{height:62px;background:#fff;border-bottom:1px solid #e9ecf4;display:flex;align-items:center;gap:12px;padding:0 32px}
  .topbar strong{color:#3e4860}.topbar form{margin:0 0 0 auto}
  .signout{border:0;background:transparent;color:#6f7c94;font-size:12px;padding:7px}.signout:hover{color:#3157de}
  .content{max-width:1200px;margin:auto;padding:32px}
  .menu{display:none;border:0;background:transparent;color:#4b5e86;font-size:19px}
  @media(max-width:900px){.sidebar{position:fixed;z-index:20;transform:translateX(-100%);transition:transform .2s;height:100%}.sidebar.expanded{transform:none;box-shadow:10px 0 25px #151c2d18}.menu{display:inline-block}.topbar{padding:0 16px}.content{padding:20px 14px}}
</style>
