<script lang="ts">
  import { enhance } from '$app/forms';
  import AppShell from '$lib/components/AppShell.svelte';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let editing = $state('');
  const TABS = [['open', 'Open'], ['today', 'Today'], ['overdue', 'Overdue'], ['upcoming', 'Upcoming'], ['nodate', 'No date'], ['done', 'Done'], ['all', 'All']] as const;
  const SORTS = [['due', 'Due date'], ['priority', 'Priority'], ['created', 'Newest']] as const;
  const href = (f: string, sort = data.sort) => `?f=${f}&sort=${sort}`;
  const EMPTY: Record<string, string> = { open: 'Nothing to do.', today: 'Nothing due today.', overdue: 'Nothing overdue.', upcoming: 'No upcoming tasks.', nodate: 'Every open task has a date.', done: 'No completed tasks yet.', all: 'No tasks yet. Add one above.' };
</script>
<svelte:head><title>Tasks · AadOS</title></svelte:head>
<AppShell title="Tasks">
<main>
  <header><h1>Tasks</h1><p>{data.counts.open} open · {data.counts.today} due today · {data.counts.overdue} overdue</p></header>
  {#if form && 'error' in form && form.error}<div class="alert">{form.error}</div>{/if}
  <form method="POST" action="?/add" use:enhance class="add"><input name="title" placeholder="Add a task or reminder…" required maxlength="200" aria-label="Task"><input type="date" name="due" aria-label="Due date"><select name="priority" aria-label="Priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select><button class="btn">Add</button></form>
  <nav class="tabs" aria-label="Task filters">{#each TABS as [f, label] (f)}<a class:on={data.filter === f} href={href(f)}>{label}<i>{data.counts[f]}</i></a>{/each}
    <span class="sort">Sort {#each SORTS as [s, label] (s)}<a class:on={data.sort === s} href={href(data.filter, s)}>{label}</a>{/each}</span></nav>
  <section>{#if data.tasks.length === 0}<div class="empty">{EMPTY[data.filter]}</div>{/if}
    <ul>{#each data.tasks as t (t.id)}
      {#if editing === t.id}
      <li class="edit"><form method="POST" action="?/edit" use:enhance={() => async ({ update }) => { await update(); editing = ''; }}><input type="hidden" name="id" value={t.id}><input name="title" value={t.title} required maxlength="200" aria-label="Task"><input type="date" name="due" value={t.due} aria-label="Due date"><select name="priority" value={t.priority || 'normal'} aria-label="Priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select><button class="btn">Save</button><button type="button" class="btn" onclick={() => editing = ''}>Cancel</button></form></li>
      {:else}
      <li class:late={t.bucket === 'overdue'} class:isdone={t.done}>
        <form method="POST" action="?/toggle" use:enhance><input type="hidden" name="id" value={t.id}><button class="check" aria-label={t.done ? 'Reopen' : 'Mark done'}>{t.done ? '✓' : '○'}</button></form>
        <div><strong>{#if t.priority === 'high'}<b class="hi" title="High priority">!</b>{/if}{t.title}</strong>{#if t.email}<a href="/pipelines/{t.email.pipelineId}">✉ {t.email.subject || '(no subject)'}</a>{/if}</div>
        {#if t.due}<time>{t.bucket === 'overdue' ? 'Overdue · ' : t.bucket === 'today' ? 'Today · ' : ''}{t.due}</time>{:else}<span></span>{/if}
        <span class="ops"><button type="button" class="x" aria-label="Edit task" onclick={() => editing = t.id}>✎</button><form method="POST" action="?/remove" use:enhance><input type="hidden" name="id" value={t.id}><button class="x" aria-label="Delete task">✕</button></form></span>
      </li>{/if}{/each}</ul></section>
  {#if data.followUps.length && (data.filter === 'open' || data.filter === 'all')}<h2>Email follow-ups</h2>
  <section><ul>{#each data.followUps as f (f.key)}
    <li class="fu"><div><strong>{f.subject || '(no subject)'}</strong><small>{f.sender}</small></div>{#if f.due}<time>{f.due}</time>{:else}<span></span>{/if}
      <form method="POST" action="?/add" use:enhance><input type="hidden" name="title" value={`Follow up: ${f.subject || f.sender}`.slice(0, 200)}><input type="hidden" name="due" value={f.due}><input type="hidden" name="emailKey" value={f.key}><button class="btn">Make task</button></form></li>{/each}</ul></section>{/if}
</main>
</AppShell>
<style>
  main{max-width:800px}header{margin-bottom:14px}h1{margin:0 0 3px;font-size:22px}header p{margin:0;color:#8a95a8;font-size:12px}h2{font-size:14px;margin:20px 0 8px;color:#53607a}
  .alert{padding:9px 14px;border-radius:9px;margin-bottom:10px;font-size:13px;background:#fff0f1;color:#a5414d}
  .add,.edit form{display:flex;gap:8px}.add{margin-bottom:12px}.add input,.add select,.edit input,.edit select{border:1px solid #e4e9f2;border-radius:10px;padding:9px 11px;font-size:13px;background:#fff;min-width:0}.add input[name=title],.edit input[name=title]{flex:1}
  .btn{border:1px solid #d9dfeb;background:#fff;border-radius:9px;padding:8px 13px;color:#43516c;font-weight:700;cursor:pointer;font-size:13px}.btn:hover{border-color:#8da2f0}
  .tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px}.tabs>a{display:inline-flex;gap:7px;align-items:center;padding:6px 11px;border-radius:9px;background:#fff;border:1px solid #e4e9f2;font-size:13px;font-weight:700;color:#53607a;text-decoration:none}.tabs>a.on{background:#3157de;border-color:#3157de;color:#fff}
  .tabs i{font-style:normal;font-size:11px;background:#f0f2f7;color:#5b6a86;border-radius:99px;padding:1px 7px}.tabs a.on i{background:#ffffff33;color:#fff}
  .sort{margin-left:auto;font-size:11px;color:#8a95a8;display:flex;gap:8px;align-items:center}.sort a{color:#8a95a8;text-decoration:none;font-weight:700}.sort a.on{color:#3157de}
  section{background:#fff;border:1px solid #e4e9f2;border-radius:12px;overflow:hidden}ul{list-style:none;margin:0;padding:0}
  li{display:grid;grid-template-columns:28px 1fr auto auto;gap:10px;align-items:center;padding:10px 14px;border-top:1px solid #eef0f5;font-size:13px}li:first-child{border-top:0}li form{margin:0}
  li.edit{display:block}li.fu{grid-template-columns:1fr auto auto}
  li div{min-width:0;display:grid}li strong{font-weight:600}li a{color:#3157de;font-size:11px;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}small{color:#8a95a8;font-size:11px}
  .hi{color:#d6475c;margin-right:5px}.isdone strong{text-decoration:line-through;color:#8a95a8}
  time{font-size:11px;font-weight:700;color:#53607a;background:#f0f2f7;border-radius:6px;padding:2px 8px}li.late time{background:#fff0f1;color:#a5414d}
  .ops{display:flex;gap:2px}.check,.x{border:0;background:none;cursor:pointer;font-size:18px;color:#8a95a8}.check:hover{color:#139488}.x{font-size:14px}.x:hover{color:#3157de}
  .empty{padding:28px;text-align:center;color:#8c96a8}
  @media(max-width:600px){.add,.edit form{flex-wrap:wrap}li{grid-template-columns:28px 1fr auto}time{grid-column:2}}
</style>
