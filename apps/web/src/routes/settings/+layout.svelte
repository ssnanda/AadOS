<script lang="ts">
  import { page } from '$app/state';
  import SyncProgress from '$lib/components/SyncProgress.svelte';
  let { children } = $props();
  const items = [
    { href: '/settings', label: 'General', icon: '⚙' },
    { href: '/settings/family', label: 'Family', icon: '👪' },
    { href: '/settings/emails', label: 'Emails', icon: '✉' }
  ];
  const active = (href: string) => href === '/settings' ? page.url.pathname === href : page.url.pathname.startsWith(href);
</script>
<div class="settings">
  <nav aria-label="Settings"><a class="home" href="/">← Home</a>{#each items as item}<a href={item.href} class:active={active(item.href)} aria-current={active(item.href) ? 'page' : undefined}><span>{item.icon}</span>{item.label}</a>{/each}</nav>
  <div class="content">{@render children()}</div>
</div>
<SyncProgress />
<style>
  .settings{display:flex;align-items:flex-start;max-width:1150px;margin:auto;color:#29344c}
  nav{position:sticky;top:0;display:grid;gap:4px;width:190px;flex:none;padding:35px 0 0 24px}
  nav a{display:flex;gap:10px;align-items:center;padding:9px 12px;border-radius:9px;color:#43516c;text-decoration:none;font-weight:600}
  nav a span{width:20px;text-align:center}
  nav a:hover{background:#eef1f8}
  nav a.active{background:#eef1ff;color:#3157de}
  nav .home{color:#8a95a8;font-weight:500;margin-bottom:8px}
  .content{flex:1;min-width:0}
  .content :global(main){max-width:none;margin:0}
  .content :global(header > a:first-child){display:none}
  @media(max-width:700px){.settings{display:block}nav{position:static;width:auto;display:flex;flex-wrap:wrap;padding:16px 16px 0}nav .home{width:100%;margin:0}}
</style>
