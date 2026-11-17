<script lang="ts">
  // Repeat rule editor (Asana's undocumented `recurrence`): never / daily / weekly / monthly / yearly.
  import { recurrenceSummary, type Recurrence } from '$lib/asana-model';
  let { value, onsave, oncancel }: { value: Recurrence; onsave: (r: Recurrence) => void; oncancel?: () => void } = $props();
  const d0 = value.data || {};
  let type = $state<Recurrence['type']>(value.type === 'periodically' ? 'daily' : value.type || 'never');
  let frequency = $state(Math.max(1, d0.frequency || 1));
  let days = $state<number[]>(d0.days_of_week?.length ? [...d0.days_of_week] : [1]);
  let byWeekday = $state(Boolean(d0.nth_weekday));
  let date = $state(d0.date ?? d0.day ?? 1);
  let nth = $state(d0.nth_weekday ?? 1);
  let month = $state(d0.month ?? 1);
  const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const build = (): Recurrence => {
    if (type === 'never') return { type: 'never', data: null };
    const data: NonNullable<Recurrence['data']> = { frequency };
    if (type === 'weekly') data.days_of_week = [...days].sort();
    if (type === 'monthly' || type === 'yearly') { if (byWeekday) { data.days_of_week = [days[0] ?? 1]; data.nth_weekday = nth; } else data.date = date; }
    if (type === 'yearly') data.month = month;
    return { type, data };
  };
  const preview = $derived(recurrenceSummary(build()) || 'Does not repeat');
  const toggleDay = (i: number) => days = days.includes(i) ? (days.length > 1 ? days.filter((x) => x !== i) : days) : [...days, i];
</script>

<div class="rec">
  <div class="line">
    <select bind:value={type} aria-label="Repeat"><option value="never">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select>
    {#if type !== 'never'}<label>every <input type="number" min="1" max="99" bind:value={frequency}> {type === 'daily' ? 'day' : type === 'weekly' ? 'week' : type === 'monthly' ? 'month' : 'year'}(s)</label>{/if}
  </div>
  {#if type === 'weekly'}<div class="days">{#each DAYS as d, i (i)}<button type="button" class:on={days.includes(i)} onclick={() => toggleDay(i)} title={LONG[i]}>{d}</button>{/each}</div>{/if}
  {#if type === 'monthly' || type === 'yearly'}
    <div class="line">
      {#if type === 'yearly'}<select bind:value={month} aria-label="Month">{#each MONTHS as m, i (i)}<option value={i + 1}>{m}</option>{/each}</select>{/if}
      <label><input type="radio" checked={!byWeekday} onchange={() => (byWeekday = false)}> on day <input type="number" min="1" max="31" bind:value={date}></label>
      <label><input type="radio" checked={byWeekday} onchange={() => (byWeekday = true)}> on the
        <select bind:value={nth} aria-label="Which"><option value={1}>1st</option><option value={2}>2nd</option><option value={3}>3rd</option><option value={4}>4th</option><option value={-1}>last</option></select>
        <select value={days[0] ?? 1} onchange={(e) => (days = [Number(e.currentTarget.value)])} aria-label="Weekday">{#each LONG as l, i (i)}<option value={i}>{l}</option>{/each}</select></label>
    </div>
  {/if}
  <div class="line foot"><small>{preview}</small><span class="sp"></span>{#if oncancel}<button type="button" onclick={oncancel}>Cancel</button>{/if}<button type="button" class="primary" onclick={() => onsave(build())}>Save</button></div>
</div>

<style>
  .rec{display:grid;gap:7px;font-size:12px;background:#fff;border:1px solid #e4e9f2;border-radius:10px;padding:10px;box-shadow:0 8px 24px #151c2d22;min-width:300px}
  .line{display:flex;gap:8px;align-items:center;flex-wrap:wrap}label{display:inline-flex;gap:4px;align-items:center;color:#53607a}
  input[type=number]{width:52px}select,input{border:1px solid #d9dfeb;border-radius:6px;padding:3px 5px;font:inherit}
  .days{display:flex;gap:4px}.days button{width:28px;height:28px;border-radius:50%;border:1px solid #d9dfeb;background:#fff;font-weight:700;cursor:pointer}.days .on{background:#3157de;border-color:#3157de;color:#fff}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:700;color:#43516c;cursor:pointer}.primary{background:#3157de;border-color:#3157de;color:#fff}
  .foot small{color:#3157de;font-weight:700}.sp{flex:1}
</style>
