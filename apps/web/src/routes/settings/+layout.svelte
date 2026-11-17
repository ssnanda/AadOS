<script lang="ts">
  // Settings open inside the normal app frame (left menu + top bar); the settings pages are tabs above the content.
  import { page } from '$app/state';
  import AppShell from '$lib/components/AppShell.svelte';
  import { SETTINGS_PAGES as items } from '$lib/settings-nav';
  let { children, data } = $props();
  const providers = [{ key: 'zoho', label: 'Zoho Mail' }, { key: 'gmail', label: 'Gmail' }];
  const active = (href: string) => href === '/settings' ? page.url.pathname === href : page.url.pathname.startsWith(href);
  const current = $derived(items.find((i) => active(i.href))?.label || 'General');
</script>
<AppShell title={`Settings · ${current}`}>
<div class="settings">
  <nav class="tabs" aria-label="Settings">{#each items as item (item.href)}<a href={item.href} class:active={active(item.href)} aria-current={active(item.href) ? 'page' : undefined}><span>{item.icon}</span>{item.label}</a>{/each}</nav>
  {#if active('/settings/emails')}<nav class="sub" aria-label="Email settings sections"><a href="/settings/emails#connections">Connections</a>{#each providers as p (p.key)}<span class="prov"><a href={`/settings/emails#${p.key}`}>{p.label}</a>{#each data.mailAccounts.filter((a) => a.provider === p.key) as a (a.id)}<a href={`/settings/emails#acct-${a.id}`} class="acct" title={a.email}>{a.email}</a>{/each}</span>{/each}</nav>{/if}
  <div class="content">{@render children()}</div>
</div>
</AppShell>
<style>
  .settings{color:#29344c;max-width:1150px}
  .tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid #e3e8f1;padding-bottom:10px;margin-bottom:10px}
  .tabs a{display:flex;gap:8px;align-items:center;padding:8px 14px;border-radius:9px;color:#43516c;text-decoration:none;font-weight:700;font-size:13px}
  .tabs a span{width:18px;text-align:center}.tabs a:hover{background:#eef1f8}.tabs a.active{background:#eef1ff;color:#3157de}
  .sub{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font-size:12px;margin-bottom:6px}
  .sub a{color:#5b6a86;text-decoration:none;font-weight:600;padding:3px 0}.sub a:hover{color:#3157de}
  .prov{display:inline-flex;gap:8px;align-items:center;background:#f6f7fa;border-radius:8px;padding:2px 9px}.prov > a:first-child{color:#43516c;font-weight:800}
  .acct{font-weight:500;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .content{min-width:0}
  .content :global(main){max-width:none;margin:0;padding:6px 0 30px}
  .content :global(main > header > a:first-child){display:none}
</style>
