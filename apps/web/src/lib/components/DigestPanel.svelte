<script lang="ts">
  // Weekly review (AI) for a view: actions / dates / updates / FYI with sources, ignored emails, and tutoring trends.
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { DigestEntry } from '$lib/server/ai/weekly-digest';
  import type { DigestViewData as Review } from '$lib/server/ai/weekly-digest-service';
  let { review }: { review: Review } = $props();
  let tab = $state<'week' | 'sessions'>('week');
  let showDone = $state(false);
  const d = $derived(review.digest);
  const s = $derived(review.sessions);
  // Poll while a run is in progress (the run happens in the background on the server).
  $effect(() => { if (!review.progress.running) return; const t = setInterval(() => void invalidateAll(), 4000); return () => clearInterval(t); });
  const fmt = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '');
  const when = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never');
  const open = (list: DigestEntry[]) => list.filter((i) => showDone || !i.mark);
  const late = (i: DigestEntry) => i.due && i.due < review.today;
  const maxWeek = $derived(Math.max(1, ...(s?.trends.weeks.map((w) => w.sessions) || [1])));
</script>

<section class="review" id="review">
  <div class="bar">
    <div class="tabs"><button class:on={tab === 'week'} onclick={() => (tab = 'week')}>This week <i>{d.actions.filter((i) => !i.mark).length}</i></button>{#if s}<button class:on={tab === 'sessions'} onclick={() => (tab = 'sessions')}>{s.label} <i>{s.trends.totals.sessions}</i></button>{/if}</div>
    <span class="meta">{#if review.progress.running}Reading {review.progress.done}/{review.progress.total}… {review.progress.note}{:else}Reviewed {when(review.lastRun)}{/if}</span>
    <form method="POST" action="?/review" use:enhance={() => async () => { await invalidateAll(); }}><button disabled={review.progress.running}>↻ Review now</button></form>
  </div>
  {#if review.error}<div class="alert">{review.error}</div>{/if}

  {#if tab === 'week'}
    <p class="meta">{d.inWindow} emails since {fmt(d.from.slice(0, 10))} · {d.reviewed} reviewed · {d.ignored.length} not for this focus{d.pending.length ? ` · ${d.pending.length} waiting` : ''}{d.failed.length ? ` · ${d.failed.length} failed` : ''} · <label class="inline"><input type="checkbox" bind:checked={showDone}> show done</label></p>
    {#snippet entry(i: DigestEntry)}
      <li class:muted={i.mark} class:late={late(i) && !i.mark}>
        <div class="main"><b>{i.title}</b>{#if i.due}<span class="due">{i.kind === 'action' ? 'Due ' : ''}{fmt(i.due)}</span>{/if}{#if i.audience}<span class="aud">{i.audience}</span>{/if}
          {#if i.detail}<p>{i.detail}</p>{/if}
          <small>{#each i.sources as src, n}{n ? ' · ' : ''}<a href={src.href}>{src.subject}</a> ({src.receivedAt.slice(5, 10)}){/each}</small></div>
        <div class="ops">
          {#if i.mark}<form method="POST" action="?/reviewMark" use:enhance><input type="hidden" name="item" value={i.id}><button name="op" value="clear">Undo</button></form>
          {:else}<form method="POST" action="?/reviewMark" use:enhance><input type="hidden" name="item" value={i.id}>{#if i.kind === 'action' || i.kind === 'date'}<button name="op" value="done" title="Done">✓</button>{/if}{#if !i.taskId && i.kind === 'action'}<button name="op" value="task" title="Add to Tasks">+ Task</button>{:else if i.taskId}<a class="task" href="/tasks">Task</a>{/if}<button name="op" value="dismissed" title="Not needed">✕</button></form>{/if}
        </div>
      </li>
    {/snippet}
    <div class="cols">
      <div><h3>Action items</h3>{#if !open(d.actions).length}<p class="none">Nothing to do.</p>{/if}<ul>{#each open(d.actions) as i (i.id)}{@render entry(i)}{/each}</ul>
        <h3>Dates</h3>{#if !open(d.dates).length}<p class="none">No dates.</p>{/if}<ul>{#each open(d.dates) as i (i.id)}{@render entry(i)}{/each}</ul></div>
      <div><h3>Updates</h3>{#if !open(d.updates).length}<p class="none">None.</p>{/if}<ul>{#each open(d.updates) as i (i.id)}{@render entry(i)}{/each}</ul>
        <h3>FYI</h3>{#if !open(d.fyi).length}<p class="none">None.</p>{/if}<ul>{#each open(d.fyi) as i (i.id)}{@render entry(i)}{/each}</ul></div>
    </div>
    {#if d.ignored.length}<details><summary>Not for this focus ({d.ignored.length})</summary><ul class="plain">{#each d.ignored as e (e.key)}<li><a href={e.href}>{e.subject}</a> <small>{e.receivedAt.slice(5, 10)} · {e.reason}</small></li>{/each}</ul></details>{/if}
    {#if d.failed.length}<details open><summary>Could not read ({d.failed.length})</summary><ul class="plain">{#each d.failed as e (e.key)}<li><a href={e.href}>{e.subject}</a> <small>{e.error}</small></li>{/each}</ul></details>{/if}
    <details><summary>Focus</summary><p class="meta">{review.focus} <a href="/settings/views">Edit</a></p></details>
  {:else if s}
    {@const t = s.trends}
    <div class="stats">
      <div><b>{t.totals.sessions}</b><small>sessions</small></div>
      <div><b>{t.totals.last30}</b><small>last 30 days{#if t.totals.prev30} <em class:up={t.totals.last30 > t.totals.prev30} class:down={t.totals.last30 < t.totals.prev30}>{t.totals.last30 >= t.totals.prev30 ? '▲' : '▼'} vs {t.totals.prev30}</em>{/if}</small></div>
      <div><b>{t.totals.mastered}</b><small>skills mastered</small></div>
      <div><b>{t.totals.checksTotal ? `${t.totals.checksPassed}/${t.totals.checksTotal}` : '—'}</b><small>checks passed</small></div>
      <div><b>{t.totals.avgGapDays ?? '—'}</b><small>avg days between</small></div>
      <div><b>{fmt(t.totals.lastDate) || '—'}</b><small>last session</small></div>
    </div>
    {#if s.pending || s.failed}<p class="meta">{s.pending ? `${s.pending} reports waiting` : ''}{s.pending && s.failed ? ' · ' : ''}{s.failed ? `${s.failed} could not be read` : ''}</p>{/if}
    {#if s.narrative}<div class="narr"><p>{s.narrative}</p><small>AI note from the session data · {when(s.narrativeAt)}</small></div>{/if}
    {#if t.weeks.length}
      <h3>Sessions per week</h3>
      <svg class="chart" viewBox="0 0 {t.weeks.length * 28} 70" preserveAspectRatio="none" role="img" aria-label="Sessions per week">
        {#each t.weeks as w, n (w.week)}<rect x={n * 28 + 4} y={60 - (w.sessions / maxWeek) * 54} width="20" height={(w.sessions / maxWeek) * 54} rx="3"><title>Week of {w.week}: {w.sessions} sessions, {w.mastered} mastered</title></rect>{#if w.mastered}<circle cx={n * 28 + 14} cy={60 - (w.sessions / maxWeek) * 54 - 5} r="2.5" class="m" />{/if}{/each}
        <line x1="0" x2={t.weeks.length * 28} y1="60" y2="60" />
      </svg>
      <p class="meta">{t.weeks[0].week} → {t.weeks[t.weeks.length - 1].week} · dot = a skill mastered that week</p>
    {/if}
    <div class="cols three">
      <div><h3>Needs practice</h3>{#if !t.stuck.length}<p class="none">Nothing stuck.</p>{/if}<ul class="plain">{#each t.stuck as k (k.name)}<li><b>{k.name}</b> <small>{k.sessions} sessions since {k.first.slice(5)} · {k.status}</small></li>{/each}</ul></div>
      <div><h3>Working on</h3>{#if !t.working.length}<p class="none">—</p>{/if}<ul class="plain">{#each t.working.slice(0, 12) as k (k.name)}<li>{k.name} <small>{k.last.slice(5)} · {k.status}</small></li>{/each}</ul></div>
      <div><h3>Mastered</h3>{#if !t.mastered.length}<p class="none">—</p>{/if}<ul class="plain">{#each t.mastered.slice(0, 15) as k (k.name)}<li>✓ {k.name} <small>{k.mastered.slice(5)}</small></li>{/each}</ul></div>
    </div>
    <details><summary>All sessions ({t.sessions.length})</summary>
      <table><thead><tr><th>Date</th><th>Skills</th><th>Checks</th><th>Notes</th></tr></thead><tbody>
        {#each [...t.sessions].reverse() as x (x.key)}<tr><td>{fmt(x.date)}{x.durationMin ? ` · ${x.durationMin}m` : ''}</td><td>{x.skills.map((k) => `${k.name}${k.status === 'mastered' ? ' ✓' : k.status === 'struggled' ? ' !' : ''}`).join('; ')}</td><td>{x.checks.map((c) => `${c.topic} ${c.score}`).join('; ')}</td><td>{x.notes}{x.homework ? ` · HW: ${x.homework}` : ''}</td></tr>{/each}
      </tbody></table>
    </details>
  {/if}
</section>

<style>
  .review{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:12px 14px;margin-bottom:16px;color:#29344c}
  .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.bar form{margin:0}.tabs{display:inline-flex;border:1px solid #e4e9f2;border-radius:9px;overflow:hidden}
  .tabs button{border:0;background:#fff;padding:6px 13px;font-weight:700;font-size:13px;color:#53607a;cursor:pointer}.tabs button.on{background:#3157de;color:#fff}.tabs i{font-style:normal;font-size:11px;opacity:.75;margin-left:4px}
  .meta{color:#8a95a8;font-size:12px;margin:6px 0;flex:1}.inline{display:inline-flex;gap:4px;align-items:center;cursor:pointer}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:5px 10px;font-weight:700;font-size:12px;color:#43516c;cursor:pointer}button:disabled{opacity:.5}
  .alert{padding:8px 12px;background:#fff0f1;color:#a5414d;border-radius:8px;margin:8px 0;font-size:13px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}.cols.three{grid-template-columns:1fr 1fr 1fr}
  h3{font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#8a95a8;margin:12px 0 6px}
  ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}.none{color:#a3adbf;font-size:12px;margin:0}
  li{display:flex;gap:8px;align-items:flex-start;border:1px solid #edf0f5;border-radius:9px;padding:7px 9px}.main{flex:1;min-width:0;font-size:13px}
  li.late{border-color:#f1c2c8;background:#fff8f9}li.muted{opacity:.5}li.muted b{text-decoration:line-through}
  .main p{margin:3px 0;color:#53607a;font-size:12px}.main small,.plain small{color:#8a95a8;font-size:11px}.main a,.plain a{color:#3157de;text-decoration:none}
  .due{margin-left:7px;font-size:11px;font-weight:700;color:#c27a12}.late .due{color:#a5414d}.aud{margin-left:6px;font-size:10px;background:#f0f2f7;border-radius:99px;padding:1px 7px;color:#6f7c94}
  .ops form{display:flex;gap:4px;margin:0}.ops button{padding:3px 7px}.task{font-size:11px;color:#7c4dde;align-self:center}
  .plain li{border:0;padding:2px 0;display:block;font-size:13px}
  details{margin-top:10px;font-size:13px}summary{cursor:pointer;color:#43516c;font-weight:700;font-size:12px}
  .stats{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:10px}.stats div{border:1px solid #edf0f5;border-radius:9px;padding:8px}.stats b{display:block;font-size:18px}.stats small{color:#8a95a8;font-size:11px}
  em{font-style:normal;font-weight:700}em.up{color:#1e7a47}em.down{color:#a5414d}
  .narr{background:#f5f8ff;border-radius:9px;padding:9px 12px;margin-top:10px;font-size:13px;white-space:pre-line}.narr p{margin:0 0 4px}.narr small{color:#8a95a8;font-size:11px}
  .chart{width:100%;height:90px}.chart rect{fill:#3157de}.chart .m{fill:#1e7a47}.chart line{stroke:#dbe1eb}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid #edf0f5;vertical-align:top}th{color:#8a95a8;font-size:11px}
  @media(max-width:760px){.cols,.cols.three{grid-template-columns:1fr}.stats{grid-template-columns:repeat(3,1fr)}}
</style>
