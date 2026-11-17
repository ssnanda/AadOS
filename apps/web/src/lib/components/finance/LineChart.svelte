<script lang="ts">
  // Small dependency-free line chart (inline SVG). Series share the x axis (dates) and y scale.
  type Series = { name: string; color: string; points: { date: string; value: number }[]; dashed?: boolean };
  let { series, height = 220, money = true }: { series: Series[]; height?: number; money?: boolean } = $props();
  const W = 800, PAD = { l: 64, r: 12, t: 10, b: 24 };
  const all = $derived(series.flatMap((s) => s.points));
  const dates = $derived([...new Set(all.map((p) => p.date))].sort());
  const min = $derived(all.length ? Math.min(...all.map((p) => p.value)) : 0), max = $derived(all.length ? Math.max(...all.map((p) => p.value)) : 1);
  const lo = $derived(min === max ? min - 1 : min - (max - min) * 0.05), hi = $derived(min === max ? max + 1 : max + (max - min) * 0.05);
  const x = (d: string) => PAD.l + (dates.length <= 1 ? 0 : (dates.indexOf(d) / (dates.length - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (height - PAD.t - PAD.b);
  const fmt = (v: number) => money ? (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v.toFixed(0)}`) : `${v.toFixed(1)}`;
  const ticks = $derived([0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f));
  let hover = $state<string | null>(null);
  function move(e: MouseEvent) {
    const svg = e.currentTarget as SVGSVGElement, r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    if (!dates.length) return;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (dates.length - 1));
    hover = dates[Math.max(0, Math.min(dates.length - 1, i))];
  }
</script>

{#if dates.length < 2}<p class="empty">Not enough history yet — a point is recorded each trading day.</p>
{:else}
<div class="chart">
  <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Chart" onmousemove={move} onmouseleave={() => (hover = null)}>
    {#each ticks as t (t)}<line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} class="grid" /><text x={PAD.l - 6} y={y(t) + 4} class="ylab">{fmt(t)}</text>{/each}
    <text x={PAD.l} y={height - 6} class="xlab">{dates[0]}</text><text x={W - PAD.r} y={height - 6} class="xlab end">{dates[dates.length - 1]}</text>
    {#each series as s (s.name)}{#if s.points.length > 1}<polyline fill="none" stroke={s.color} stroke-width="2" stroke-dasharray={s.dashed ? '5 4' : undefined} points={s.points.filter((p) => dates.includes(p.date)).map((p) => `${x(p.date)},${y(p.value)}`).join(' ')} />{/if}{/each}
    {#if hover}<line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={height - PAD.b} class="cursor" />{/if}
  </svg>
  <div class="legend">{#each series as s (s.name)}{@const p = hover ? s.points.find((q) => q.date === hover) : s.points[s.points.length - 1]}<span><i style="background:{s.color}"></i>{s.name}{#if p}: <b>{fmt(p.value)}</b>{/if}</span>{/each}{#if hover}<span class="muted">{hover}</span>{/if}</div>
</div>
{/if}

<style>
  .chart{display:grid;gap:4px}svg{width:100%;height:auto}.grid{stroke:#eef0f5}.ylab{font-size:11px;fill:#8a95a8;text-anchor:end}.xlab{font-size:11px;fill:#8a95a8}.xlab.end{text-anchor:end}.cursor{stroke:#c3cad8;stroke-dasharray:3 3}
  .legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:#53607a}.legend i{display:inline-block;width:10px;height:3px;border-radius:2px;margin-right:5px;vertical-align:middle}.muted,.empty{color:#8a95a8}.empty{font-size:13px;margin:6px 0}
</style>
