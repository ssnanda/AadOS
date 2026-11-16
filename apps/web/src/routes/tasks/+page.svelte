<script lang="ts">
  import { enhance } from '$app/forms';
  import AppShell from '$lib/components/AppShell.svelte';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const open = $derived(data.tasks.filter((t) => !t.done));
  const done = $derived(data.tasks.filter((t) => t.done));
  const overdue = (due: string) => due && due < data.today;
</script>
<svelte:head><title>Tasks · AadOS</title></svelte:head>
<AppShell title="Tasks">
<main>
  <header><h1>Tasks</h1><p>{open.length} open · {open.filter((t) => overdue(t.due)).length} overdue</p></header>
  {#if form && 'error' in form && form.error}<div class="alert">{form.error}</div>{/if}
  <form method="POST" action="?/add" use:enhance class="add"><input name="title" placeholder="Add a task or reminder…" required maxlength="200" aria-label="Task"><input type="date" name="due" aria-label="Due date"><button class="btn">Add</button></form>
  <section>{#if open.length === 0}<div class="empty">Nothing to do.</div>{/if}
    <ul>{#each open as t (t.id)}
      <li class:late={overdue(t.due)}>
        <form method="POST" action="?/toggle" use:enhance><input type="hidden" name="id" value={t.id}><button class="check" aria-label="Mark done">○</button></form>
        <div><strong>{t.title}</strong>{#if t.email}<a href="/pipelines/{t.email.pipelineId}">✉ {t.email.subject || '(no subject)'}</a>{/if}</div>
        {#if t.due}<time>{overdue(t.due) ? 'Overdue · ' : ''}{t.due}</time>{/if}
        <form method="POST" action="?/remove" use:enhance><input type="hidden" name="id" value={t.id}><button class="x" aria-label="Delete task">✕</button></form>
      </li>{/each}</ul></section>
  {#if data.followUps.length}<h2>Email follow-ups</h2>
  <section><ul>{#each data.followUps as f (f.key)}
    <li><div><strong>{f.subject || '(no subject)'}</strong><small>{f.sender}</small></div>{#if f.due}<time>{f.due}</time>{/if}
      <form method="POST" action="?/add" use:enhance><input type="hidden" name="title" value={`Follow up: ${f.subject || f.sender}`.slice(0, 200)}><input type="hidden" name="due" value={f.due}><input type="hidden" name="emailKey" value={f.key}><button class="btn">Make task</button></form></li>{/each}</ul></section>{/if}
  {#if done.length}<h2>Done</h2><section class="doneList"><ul>{#each done as t (t.id)}<li><form method="POST" action="?/toggle" use:enhance><input type="hidden" name="id" value={t.id}><button class="check" aria-label="Reopen">✓</button></form><div><strong>{t.title}</strong></div><span></span><form method="POST" action="?/remove" use:enhance><input type="hidden" name="id" value={t.id}><button class="x" aria-label="Delete task">✕</button></form></li>{/each}</ul></section>{/if}
</main>
</AppShell>
<style>
  main{max-width:800px}header{margin-bottom:14px}h1{margin:0 0 3px;font-size:22px}header p{margin:0;color:#8a95a8;font-size:12px}h2{font-size:14px;margin:20px 0 8px;color:#53607a}
  .alert{padding:9px 14px;border-radius:9px;margin-bottom:10px;font-size:13px;background:#fff0f1;color:#a5414d}
  .add{display:flex;gap:8px;margin-bottom:14px}.add input{border:1px solid #e4e9f2;border-radius:10px;padding:10px 12px;font-size:14px;background:#fff}.add input[name=title]{flex:1;min-width:0}
  .btn{border:1px solid #d9dfeb;background:#fff;border-radius:9px;padding:8px 13px;color:#43516c;font-weight:700;cursor:pointer;font-size:13px}.btn:hover{border-color:#8da2f0}
  section{background:#fff;border:1px solid #e4e9f2;border-radius:12px;overflow:hidden}ul{list-style:none;margin:0;padding:0}
  li{display:grid;grid-template-columns:28px 1fr auto 28px;gap:10px;align-items:center;padding:10px 14px;border-top:1px solid #eef0f5;font-size:13px}li:first-child{border-top:0}li form{margin:0}
  li div{min-width:0;display:grid}li strong{font-weight:600}li a{color:#3157de;font-size:11px;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}small{color:#8a95a8;font-size:11px}
  time{font-size:11px;font-weight:700;color:#53607a;background:#f0f2f7;border-radius:6px;padding:2px 8px}li.late time{background:#fff0f1;color:#a5414d}
  .check,.x{border:0;background:none;cursor:pointer;font-size:18px;color:#8a95a8}.check:hover{color:#139488}.x{font-size:13px}.x:hover{color:#a5414d}
  .doneList strong{text-decoration:line-through;color:#8a95a8}.empty{padding:28px;text-align:center;color:#8c96a8}
  @media(max-width:600px){.add{flex-wrap:wrap}li{grid-template-columns:28px 1fr 28px}time{grid-column:2}}
</style>
