<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  type Job = { running: boolean; stopped: boolean; current: string; scanned: number; added: number; done: number; total: number; finishedAt: string; error: string };
  let job = $state<Job | null>(null);
  let dismissed = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wasRunning = false;

  async function poll() {
    clearTimeout(timer);
    try { job = await (await fetch('/sync/full')).json(); } catch { return; }
    if (job?.running) { wasRunning = true; timer = setTimeout(poll, 2000); }
    else if (wasRunning) { wasRunning = false; await invalidateAll(); }
  }
  async function stop() {
    await fetch('/sync/full', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cancel: true }) });
    poll();
  }
  onMount(() => { poll(); window.addEventListener('aados:fullsync', poll); return () => { clearTimeout(timer); window.removeEventListener('aados:fullsync', poll); }; });

  // A finished run stays visible for a while so the result is not missed.
  let recent = $derived(job && !job.running && job.finishedAt && Date.now() - new Date(job.finishedAt).getTime() < 15 * 60 * 1000 && dismissed !== job.finishedAt);
</script>
{#if job?.running}
  <div class="bar run" role="status"><span class="spin">⟳</span><div><strong>Syncing all emails</strong><small>{job.current} · view {Math.min(job.done + 1, job.total)} of {job.total} · +{job.added} new · {job.scanned} scanned</small></div><button onclick={stop}>Stop</button></div>
{:else if recent && job}
  <div class="bar" class:err={job.error} role="status"><div><strong>{job.error ? 'Sync stopped by an error' : job.stopped ? 'Sync stopped' : 'Sync complete'}</strong><small>{job.error || `+${job.added} new emails · ${job.scanned} scanned`}</small></div><button onclick={() => dismissed = job?.finishedAt ?? ''}>✕</button></div>
{/if}
<style>
  .bar{position:fixed;right:18px;bottom:18px;z-index:50;display:flex;gap:12px;align-items:center;max-width:420px;background:#fff;border:1px solid #cfe9e4;border-left:4px solid #139488;border-radius:12px;padding:12px 14px;box-shadow:0 10px 30px #1b2a5a22;font-size:13px;color:#29344c}
  .bar.run{border-left-color:#c98a1d;border-color:#f1e1bd}.bar.err{border-left-color:#d6475c;border-color:#f6cfd5}
  .bar div{display:grid;gap:2px;min-width:0}.bar small{color:#7c879b;font-size:11px}
  .bar button{margin-left:auto;border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;color:#43516c;cursor:pointer}
  .spin{display:inline-block;animation:spin 1s linear infinite;color:#c98a1d;font-size:18px}@keyframes spin{to{transform:rotate(360deg)}}
</style>
