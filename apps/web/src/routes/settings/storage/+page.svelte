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
    <form method="POST" action="?/save" class="cfg">
      <label class="wide">Endpoint<input name="endpoint" type="url" value={data.form.endpoint} placeholder="https://rustfs.example.com" disabled={data.locked.endpoint}>{#if data.locked.endpoint}<small>Set by environment</small>{/if}</label>
      <label>Bucket<input name="bucket" value={data.form.bucket} placeholder="aados" disabled={data.locked.bucket}>{#if data.locked.bucket}<small>Set by environment</small>{/if}</label>
      <label>Region <small>optional</small><input name="region" value={data.form.region} placeholder="us-east-1" disabled={data.locked.region}></label>
      <label>Access key<input name="accessKey" type="password" autocomplete="off" placeholder={data.form.hasAccessKey ? 'Saved — leave blank to keep' : 'Access key ID'} disabled={data.locked.accessKey}>{#if data.locked.accessKey}<small>Set by environment</small>{/if}</label>
      <label>Secret key<input name="secretKey" type="password" autocomplete="off" placeholder={data.form.hasSecretKey ? 'Saved — leave blank to keep' : 'Secret access key'} disabled={data.locked.secretKey}>{#if data.locked.secretKey}<small>Set by environment</small>{/if}</label>
      <label>Key prefix <small>optional</small><input name="prefix" value={data.form.prefix} placeholder="aados/" disabled={data.locked.prefix}></label>
      <label class="check"><input type="checkbox" name="forcePathStyle" checked={data.form.forcePathStyle} disabled={data.locked.forcePathStyle}> Path-style addressing <small>(usual for RustFS)</small></label>
      <div class="row wide"><button>Save</button>{#if data.form.hasAccessKey && !data.locked.accessKey}<label class="check"><input type="checkbox" name="clearKeys"> Remove saved keys</label>{/if}<small>Keys are stored encrypted and never shown again.</small></div>
    </form>
    <dl>
      <dt>Status</dt><dd class:err={!data.status.configured}>{data.status.configured ? `Ready · ${data.status.endpoint} · ${data.status.bucket}` : data.status.problem}</dd>
      <dt>Last success</dt><dd>{data.lastOk ? new Date(data.lastOk).toLocaleString() : '—'}</dd>
      <dt>Used by AadOS</dt><dd>{data.usage ? `${data.usage.files} files · ${mb(data.usage.bytes)}` : '—'}</dd>
    </dl>
    <form method="POST" action="?/test"><button disabled={!data.status.configured}>Test connection</button></form>
  </section>
  <details><summary>Setup</summary>
    <p>Use a dedicated private bucket (for example <code>aados</code>) and an access key limited to that bucket. Files are stored under <code>aados/documents/&lt;random id&gt;</code>; filenames are kept only in the database. Downloads go through AadOS after login, never through public links.</p>
    <p>Fields can also be fixed by the environment (OpenShift Secrets or <code>bin/dev-local.sh config</code>), which then override these settings: <code>AADOS_S3_ENDPOINT</code> (https), <code>AADOS_S3_BUCKET</code>, <code>AADOS_S3_ACCESS_KEY</code>, <code>AADOS_S3_SECRET_KEY</code>, optional <code>AADOS_S3_REGION</code> (default us-east-1), <code>AADOS_S3_FORCE_PATH_STYLE</code> (default true), <code>AADOS_S3_PREFIX</code> (default aados/).</p>
  </details>
</main>
<style>
  main{padding:35px;color:#29344c;max-width:760px}header{display:flex;gap:10px;align-items:center;margin-bottom:14px}h1{margin:0}h2{margin:0 0 10px;font-size:15px}
  .pill{font-size:11px;font-weight:800;border-radius:99px;padding:3px 9px;background:#f0f2f7;color:#5b6a86}.pill.ok{background:#e3f6f3;color:#0f7f74}
  section{background:#fff;border:1px solid #e3e8f1;border-radius:14px;padding:16px 20px;margin-bottom:12px}
  dl{display:grid;grid-template-columns:130px 1fr;gap:6px 12px;margin:0 0 12px;font-size:13px}dt{color:#8a95a8;font-weight:700;font-size:12px}dd{margin:0;word-break:break-word}.err{color:#a5414d}
  .cfg{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}.cfg .wide{grid-column:1/-1}.cfg label{display:grid;gap:4px;font-size:12px;font-weight:700;color:#53607a}.cfg input{border:1px solid #dbe1eb;border-radius:8px;padding:8px;font:inherit;font-size:13px;font-weight:400;min-width:0}.cfg input:disabled{background:#f4f6fa}.cfg small{font-weight:400;color:#8a95a8;font-size:11px}.cfg .check{display:flex;gap:6px;align-items:center;font-weight:400}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  @media(max-width:640px){.cfg{grid-template-columns:1fr}}
  form{margin:0}button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:8px 13px;cursor:pointer;color:#3157de;font-weight:700}button:disabled{opacity:.5;cursor:default}
  .bad,.good{padding:9px 12px;border-radius:9px;font-size:13px}.bad{background:#fff0f1;color:#a5414d}.good{background:#e3f6f3;color:#0f7f74}details{font-size:13px;color:#53607a}summary{cursor:pointer;font-weight:700}code{background:#f4f6fa;border-radius:4px;padding:1px 4px}
</style>
