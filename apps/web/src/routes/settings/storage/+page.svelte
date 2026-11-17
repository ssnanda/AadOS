<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
</script>
<svelte:head><title>Storage · Settings · AadOS</title></svelte:head>
<main>
  <header><h1>Storage</h1><span class="pill" class:ok={data.status.configured}>{data.status.configured ? 'Configured' : 'Not configured'}</span></header>
  {#if form && 'error' in form && form.error}<p class="bad">{form.error}</p>{/if}
  {#if form && 'message' in form && form.message}<p class="good">{form.message}</p>{/if}
  <section><h2>RustFS (S3-compatible)</h2>
    <dl>
      <dt>Endpoint</dt><dd>{data.status.endpoint || '—'}</dd>
      <dt>Bucket</dt><dd>{data.status.bucket || '—'}</dd>
      <dt>Status</dt><dd class:err={!data.status.configured}>{data.status.configured ? 'Ready' : data.status.problem}</dd>
      <dt>Last success</dt><dd>{data.lastOk ? new Date(data.lastOk).toLocaleString() : '—'}</dd>
      <dt>Used by AadOS</dt><dd>{data.usage ? `${data.usage.files} files · ${mb(data.usage.bytes)}` : '—'}</dd>
    </dl>
    <form method="POST" action="?/test"><button disabled={!data.status.configured}>Test connection</button></form>
  </section>
  <details><summary>Setup</summary>
    <p>Use a dedicated private bucket (for example <code>aados</code>) and an access key limited to that bucket. Files are stored under <code>aados/documents/&lt;random id&gt;</code>; filenames are kept only in the database. Downloads go through AadOS after login, never through public links.</p>
    <p>Environment (secrets via <code>bin/dev-local.sh config</code> locally or OpenShift Secrets): <code>AADOS_S3_ENDPOINT</code> (https), <code>AADOS_S3_BUCKET</code>, <code>AADOS_S3_ACCESS_KEY</code>, <code>AADOS_S3_SECRET_KEY</code>, optional <code>AADOS_S3_REGION</code> (default us-east-1), <code>AADOS_S3_FORCE_PATH_STYLE</code> (default true), <code>AADOS_S3_PREFIX</code> (default aados/).</p>
  </details>
</main>
<style>
  main{padding:35px;color:#29344c;max-width:760px}header{display:flex;gap:10px;align-items:center;margin-bottom:14px}h1{margin:0}h2{margin:0 0 10px;font-size:15px}
  .pill{font-size:11px;font-weight:800;border-radius:99px;padding:3px 9px;background:#f0f2f7;color:#5b6a86}.pill.ok{background:#e3f6f3;color:#0f7f74}
  section{background:#fff;border:1px solid #e3e8f1;border-radius:14px;padding:16px 20px;margin-bottom:12px}
  dl{display:grid;grid-template-columns:130px 1fr;gap:6px 12px;margin:0 0 12px;font-size:13px}dt{color:#8a95a8;font-weight:700;font-size:12px}dd{margin:0;word-break:break-word}.err{color:#a5414d}
  form{margin:0}button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:8px 13px;cursor:pointer;color:#3157de;font-weight:700}button:disabled{opacity:.5;cursor:default}
  .bad,.good{padding:9px 12px;border-radius:9px;font-size:13px}.bad{background:#fff0f1;color:#a5414d}.good{background:#e3f6f3;color:#0f7f74}details{font-size:13px;color:#53607a}summary{cursor:pointer;font-weight:700}code{background:#f4f6fa;border-radius:4px;padding:1px 4px}
</style>
