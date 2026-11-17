<script lang="ts">
  import { page } from '$app/state';
  import SyncProgress from '$lib/components/SyncProgress.svelte';
  let { children, data } = $props();
  const providers = [{ key: 'zoho', label: 'Zoho Mail' }, { key: 'gmail', label: 'Gmail' }];
  const items = [
    { href: '/settings', label: 'General', icon: '⚙' },
    { href: '/settings/family', label: 'Family', icon: '👪' },
    { href: '/settings/emails', label: 'Emails', icon: '✉' },
    { href: '/settings/ai', label: 'AI', icon: '✦' },
    { href: '/settings/storage', label: 'Storage', icon: '▤' }
  ];
  const active = (href: string) => href === '/settings' ? page.url.pathname === href : page.url.pathname.startsWith(href);
</script>
<div class="settings">
  <nav aria-label="Settings"><a class="home" href="/">← Home</a>{#each items as item}<a href={item.href} class:active={active(item.href)} aria-current={active(item.href) ? 'page' : undefined}><span>{item.icon}</span>{item.label}</a>
    {#if item.href === '/settings/emails' && active(item.href)}<div class="sub"><a href="/settings/emails#connections">Connections</a>{#each providers as p}<a href={`/settings/emails#${p.key}`} class="prov">{p.label}</a>{#each data.mailAccounts.filter((a) => a.provider === p.key) as a (a.id)}<a href={`/settings/emails#acct-${a.id}`} class="acct" title={a.email}>{a.email}</a>{/each}{/each}<a href="/settings/emails#views">Views</a></div>{/if}{/each}</nav>
  <div class="content">{@render children()}</div>
</div>
<SyncProgress />
<style>
  .settings{display:flex;align-items:flex-start;max-width:1150px;margin:auto;color:#29344c}
  nav{position:sticky;top:0;display:grid;gap:4px;width:230px;flex:none;padding:35px 0 0 24px}
  nav a{display:flex;gap:10px;align-items:center;padding:9px 12px;border-radius:9px;color:#43516c;text-decoration:none;font-weight:600}
  nav a span{width:20px;text-align:center}
  nav a:hover{background:#eef1f8}
  nav a.active{background:#eef1ff;color:#3157de}
  .sub{display:grid;gap:1px;margin:-2px 0 6px 22px;border-left:1px solid #e3e8f1;padding-left:8px}
  .sub a{padding:5px 8px;font-size:13px;font-weight:600;color:#5b6a86}.sub .prov{margin-top:3px;color:#43516c}.sub .acct{padding-left:18px;font-weight:500;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
  nav .home{color:#8a95a8;font-weight:500;margin-bottom:8px}
  .content{flex:1;min-width:0}
  .content :global(main){max-width:none;margin:0}
  .content :global(header > a:first-child){display:none}
  @media(max-width:700px){.settings{display:block}nav{position:static;width:auto;display:flex;flex-wrap:wrap;padding:16px 16px 0}nav .home{width:100%;margin:0}}
</style>
