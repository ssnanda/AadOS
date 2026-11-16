<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>
<svelte:head><title>General · Settings · AadOS</title></svelte:head>
<main><header><div><h1>General</h1></div></header>
<section><h2>Sessions</h2><form method="POST" action="/logout"><input type="hidden" name="all" value="1"><button onclick={(e) => { if (!confirm('Sign out on every device?')) e.preventDefault(); }}>Sign out everywhere</button></form></section>
{#if data.db.mode === 'compare'}<section><h2>Database</h2>
  {#if data.db.error}<p class="bad">{data.db.error}</p>{:else if data.db.comparison?.match}<p class="ok">Mirror matches legacy state</p>{:else if data.db.comparison}<ul class="bad">{#each data.db.comparison.differences as d (d)}<li>{d}</li>{/each}</ul>{/if}</section>{/if}</main>
<style>main{padding:35px;color:#29344c}h1{margin:0 0 14px}h2{margin:0 0 10px;font-size:15px}section{background:#fff;border:1px solid #e3e8f1;border-radius:14px;padding:16px 20px;max-width:520px}form{margin:0}section+section{margin-top:12px}.ok{color:#0f7f74;margin:0;font-size:13px}.bad{color:#a5414d;margin:0;font-size:13px;padding-left:0;list-style:none}button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:9px 13px;cursor:pointer;color:#a5414d;font-weight:700}</style>
