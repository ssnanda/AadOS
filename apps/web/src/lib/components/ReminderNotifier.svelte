<script lang="ts">
  // Browser notifications for due reminders while AadOS is open in a tab. In-app reminders work regardless.
  // De-duplication: ids already shown are remembered (localStorage), and only reminders fired after this tab started
  // (or the last poll) are requested, so a server restart or reopening the app never produces a notification storm.
  import { goto } from '$app/navigation';
  let { enabled }: { enabled: boolean } = $props();
  const KEY = 'aados-notified';
  $effect(() => {
    if (!enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    let since = new Date(Date.now() - 2 * 60_000).toISOString();
    const shown = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } })());
    const poll = async () => {
      try {
        const res = await fetch(`/reminders/feed?since=${encodeURIComponent(since)}`);
        if (!res.ok) return;
        const body = await res.json();
        since = body.now;
        if (!body.enabled) return;
        for (const r of body.items) {
          if (shown.has(r.id)) continue;
          shown.add(r.id);
          const n = new Notification('AadOS reminder', { body: r.title, tag: `aados-${r.id}` });
          n.onclick = () => { window.focus(); goto(r.link); n.close(); };
        }
        try { localStorage.setItem(KEY, JSON.stringify([...shown].slice(-500))); } catch { /* storage unavailable */ }
      } catch { /* offline: try again next time */ }
    };
    poll();
    const timer = setInterval(poll, 60_000);
    return () => clearInterval(timer);
  });
</script>
