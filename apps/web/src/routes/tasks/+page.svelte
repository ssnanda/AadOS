<script lang="ts">
  import { enhance } from '$app/forms';
  import AppShell from '$lib/components/AppShell.svelte';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let editing = $state('');
  const TABS = [['open', 'Open'], ['today', 'Today'], ['overdue', 'Overdue'], ['upcoming', 'Upcoming'], ['nodate', 'No date'], ['done', 'Completed'], ['all', 'All']] as const;
  const SORTS = [['due', 'Due date'], ['priority', 'Priority'], ['created', 'Newest']] as const;
  const href = (over: Record<string, string> = {}) => { const m = { f: data.filter, sort: data.sort, q: data.q, tag: data.tag, ...over }; const q = new URLSearchParams(); for (const [k, v] of Object.entries(m)) if (v && !(k === 'f' && v === 'open') && !(k === 'sort' && v === 'due')) q.set(k, v); const s = q.toString(); return s ? `?${s}` : '?'; };
  const EMPTY: Record<string, string> = { open: 'Nothing to do.', today: 'Nothing due today.', overdue: 'Nothing overdue.', upcoming: 'No upcoming tasks.', nodate: 'Every open task has a date.', done: 'No completed tasks yet.', all: 'No tasks yet. Add one above.' };
  const dup = $derived(form && 'duplicate' in form && form.duplicate ? (form as unknown as { values: Record<string, unknown> }).values : null);
  const t12 = (hm: string) => { const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const confirmDelete = ({ cancel }: { cancel: () => void }) => { if (!confirm('Delete this task? This cannot be undone.')) cancel(); };
</script>
<svelte:head><title>Tasks · AadOS</title></svelte:head>
<AppShell title="Tasks">
<main>
  <header><h1>Tasks</h1><p>{data.counts.open} open · {data.counts.today} due today · {data.counts.overdue} overdue</p></header>
  {#if form && 'error' in form && form.error}<div class="alert">{form.error}
    {#if dup}<form method="POST" action="?/add" use:enhance class="inline">{#each Object.entries(dup) as [k, v] (k)}<input type="hidden" name={k} value={String(v)}>{/each}<input type="hidden" name="force" value="1"><button class="btn">Add anyway</button></form>{/if}</div>{/if}
  <form method="POST" action="?/add" use:enhance class="add">
    <div class="line"><input name="title" placeholder="Add a task…" required maxlength="200" aria-label="Task"><input type="date" name="due" aria-label="Due date"><input type="time" name="dueTime" aria-label="Due time"><select name="priority" aria-label="Priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select><button class="btn">Add</button></div>
    <details><summary>Notes and tags</summary><div class="line"><input name="tags" placeholder="Tags, comma separated" maxlength="120" aria-label="Tags"><textarea name="notes" placeholder="Notes" maxlength="2000" rows="2" aria-label="Notes"></textarea></div></details>
  </form>
  <form class="find" method="GET"><span>⌕</span><input type="search" name="q" value={data.q} placeholder="Search tasks…" aria-label="Search tasks">{#if data.filter !== 'open'}<input type="hidden" name="f" value={data.filter}>{/if}{#if data.sort !== 'due'}<input type="hidden" name="sort" value={data.sort}>{/if}{#if data.tag}<input type="hidden" name="tag" value={data.tag}>{/if}</form>
  <nav class="tabs" aria-label="Task filters">{#each TABS as [f, label] (f)}<a class:on={data.filter === f} href={href({ f })}>{label}<i>{data.counts[f]}</i></a>{/each}
    <span class="sort">Sort {#each SORTS as [s, label] (s)}<a class:on={data.sort === s} href={href({ sort: s })}>{label}</a>{/each}</span></nav>
  {#if data.tags.length}<div class="chips">{#each data.tags as tag (tag)}<a class="chip" class:on={data.tag === tag} href={href({ tag: data.tag === tag ? '' : tag })}>#{tag}</a>{/each}</div>{/if}
  <section>{#if data.tasks.length === 0}<div class="empty">{data.q || data.tag ? 'No tasks match.' : EMPTY[data.filter]}</div>{/if}
    <ul>{#each data.tasks as t (t.id)}
      {#if editing === t.id}
      <li class="edit"><form method="POST" action="?/edit" use:enhance={() => async ({ update }) => { await update(); editing = ''; }}><input type="hidden" name="id" value={t.id}>
        <div class="line"><input name="title" value={t.title} required maxlength="200" aria-label="Task"><input type="date" name="due" value={t.due} aria-label="Due date"><input type="time" name="dueTime" value={t.dueTime || ''} aria-label="Due time"><select name="priority" value={t.priority || 'normal'} aria-label="Priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></div>
        <div class="line"><input name="tags" value={(t.tags || []).join(', ')} placeholder="Tags, comma separated" maxlength="120" aria-label="Tags"><textarea name="notes" placeholder="Notes" maxlength="2000" rows="2" aria-label="Notes">{t.notes || ''}</textarea></div>
        <div class="line"><button class="btn">Save</button><button type="button" class="btn" onclick={() => editing = ''}>Cancel</button></div></form></li>
      {:else}
      <li class:late={t.bucket === 'overdue'} class:isdone={t.done}>
        <form method="POST" action="?/toggle" use:enhance><input type="hidden" name="id" value={t.id}><button class="check" aria-label={t.done ? 'Reopen' : 'Mark done'}>{t.done ? '✓' : '○'}</button></form>
        <div><strong>{#if t.priority === 'high'}<b class="hi" title="High priority">!</b>{/if}{t.title}{#each t.tags || [] as tag (tag)} <a class="tg" href={href({ tag })}>#{tag}</a>{/each}</strong>
          {#if t.notes}<small class="notes">{t.notes}</small>{/if}
          {#if t.email}<a class="ln" href={t.email.href}>✉ {t.email.subject || '(no subject)'}</a>{/if}{#if t.event}<a class="ln" href={t.event.href}>▣ {t.event.title}</a>{/if}</div>
        {#if t.due}<time>{t.bucket === 'overdue' ? 'Overdue · ' : t.bucket === 'today' ? 'Today · ' : ''}{t.due}{t.dueTime ? ` · ${t12(t.dueTime)}` : ''}</time>{:else}<span></span>{/if}
        <span class="ops"><button type="button" class="x" aria-label="Edit task" onclick={() => editing = t.id}>✎</button><form method="POST" action="?/remove" use:enhance={confirmDelete}><input type="hidden" name="id" value={t.id}><button class="x" aria-label="Delete task">✕</button></form></span>
      </li>{/if}{/each}</ul></section>
  {#if data.followUps.length && (data.filter === 'open' || data.filter === 'all') && !data.q && !data.tag}<h2>Email follow-ups</h2>
  <section><ul>{#each data.followUps as f (f.key)}
    <li class="fu"><div><strong>{f.subject || '(no subject)'}</strong><small>{f.sender}</small></div>{#if f.due}<time>{f.due}</time>{:else}<span></span>{/if}
      <form method="POST" action="?/add" use:enhance><input type="hidden" name="title" value={`Follow up: ${f.subject || f.sender}`.slice(0, 200)}><input type="hidden" name="due" value={f.due}><input type="hidden" name="emailKey" value={f.key}><button class="btn">Make task</button></form></li>{/each}</ul></section>{/if}
</main>
</AppShell>
<style>
  main{max-width:860px}header{margin-bottom:14px}h1{margin:0 0 3px;font-size:22px}header p{margin:0;color:#8a95a8;font-size:12px}h2{font-size:14px;margin:20px 0 8px;color:#53607a}
  .alert{padding:9px 14px;border-radius:9px;margin-bottom:10px;font-size:13px;background:#fff0f1;color:#a5414d;display:flex;gap:12px;align-items:center}.inline{margin:0 0 0 auto}
  .add{margin-bottom:10px}.line{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}.line input,.line select,.line textarea{border:1px solid #e4e9f2;border-radius:10px;padding:9px 11px;font:inherit;font-size:13px;background:#fff;min-width:0}.line input[name=title],.line textarea{flex:1;min-width:170px}
  details summary{cursor:pointer;font-size:11px;color:#8a95a8;font-weight:700;margin:0 0 6px 2px}
  .btn{border:1px solid #d9dfeb;background:#fff;border-radius:9px;padding:8px 13px;color:#43516c;font-weight:700;cursor:pointer;font-size:13px}.btn:hover{border-color:#8da2f0}
  .find{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e4e9f2;border-radius:10px;padding:0 12px;margin-bottom:10px}.find:focus-within{border-color:#8da2f0}.find span{color:#8a95a8;font-size:18px}.find input{border:0;outline:0;flex:1;padding:9px 0;font-size:13px;background:transparent}
  .tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px}.tabs>a{display:inline-flex;gap:7px;align-items:center;padding:6px 11px;border-radius:9px;background:#fff;border:1px solid #e4e9f2;font-size:13px;font-weight:700;color:#53607a;text-decoration:none}.tabs>a.on{background:#3157de;border-color:#3157de;color:#fff}
  .tabs i{font-style:normal;font-size:11px;background:#f0f2f7;color:#5b6a86;border-radius:99px;padding:1px 7px}.tabs a.on i{background:#ffffff33;color:#fff}
  .sort{margin-left:auto;font-size:11px;color:#8a95a8;display:flex;gap:8px;align-items:center}.sort a{color:#8a95a8;text-decoration:none;font-weight:700}.sort a.on{color:#3157de}
  .chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.chip{background:#fff;border:1px solid #e4e9f2;border-radius:99px;padding:3px 10px;font-size:12px;font-weight:700;color:#43516c;text-decoration:none}.chip.on{background:#3157de;border-color:#3157de;color:#fff}
  section{background:#fff;border:1px solid #e4e9f2;border-radius:12px;overflow:hidden}ul{list-style:none;margin:0;padding:0}
  li{display:grid;grid-template-columns:28px 1fr auto auto;gap:10px;align-items:center;padding:10px 14px;border-top:1px solid #eef0f5;font-size:13px}li:first-child{border-top:0}li form{margin:0}
  li.edit{display:block}li.fu{grid-template-columns:1fr auto auto}
  li div{min-width:0;display:grid}li strong{font-weight:600}.ln{color:#3157de;font-size:11px;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}small{color:#8a95a8;font-size:11px}.notes{white-space:pre-wrap}
  .tg{color:#7c4dde;font-size:11px;font-weight:700;text-decoration:none}.hi{color:#d6475c;margin-right:5px}.isdone strong{text-decoration:line-through;color:#8a95a8}
  time{font-size:11px;font-weight:700;color:#53607a;background:#f0f2f7;border-radius:6px;padding:2px 8px;white-space:nowrap}li.late time{background:#fff0f1;color:#a5414d}
  .ops{display:flex;gap:2px}.check,.x{border:0;background:none;cursor:pointer;font-size:18px;color:#8a95a8}.check:hover{color:#139488}.x{font-size:14px}.x:hover{color:#3157de}
  .empty{padding:28px;text-align:center;color:#8c96a8}
  @media(max-width:600px){li{grid-template-columns:28px 1fr auto}time{grid-column:2;justify-self:start}}
</style>
