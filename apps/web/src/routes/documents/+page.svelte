<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import AppShell from '$lib/components/AppShell.svelte';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let uploads = $state<{ name: string; pct: number; error: string; note: string }[]>([]);
  let folder = $state('');
  let editing = $state('');
  const size = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
  const label = (mime: string) => (data.types as Record<string, { label: string }>)[mime]?.label || mime;
  const STATUS: Record<string, string> = { pending: 'Indexing…', done: 'Searchable', failed: 'Text extraction failed', unsupported: 'Not searchable' };

  function upload(file: File) {
    const entry = { name: file.name, pct: 0, error: '', note: '' };
    uploads = [...uploads, entry];
    const i = uploads.length - 1;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/documents/upload?name=${encodeURIComponent(file.name)}&folder=${encodeURIComponent(folder)}`);
    // Always send a content type: without one the server receives no body (and some browsers leave .docx untyped).
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) uploads[i].pct = Math.round((e.loaded / e.total) * 100); };
    xhr.onload = async () => {
      const body = JSON.parse(xhr.responseText || '{}');
      if (xhr.status >= 400) uploads[i].error = body.error || `HTTP ${xhr.status}`; else { uploads[i].pct = 100; uploads[i].note = body.duplicate ? 'Already stored (same content)' : 'Uploaded'; await invalidateAll(); }
    };
    xhr.onerror = () => { uploads[i].error = 'Network error'; };
    xhr.send(file);
  }
  const pick = (e: Event) => { for (const f of Array.from((e.currentTarget as HTMLInputElement).files || [])) upload(f); (e.currentTarget as HTMLInputElement).value = ''; };
  const drop = (e: DragEvent) => { e.preventDefault(); for (const f of Array.from(e.dataTransfer?.files || [])) upload(f); };
  const confirmDelete = ({ cancel }: { cancel: () => void }) => { if (!confirm('Delete this document from AadOS and RustFS? This cannot be undone.')) cancel(); };
</script>
<svelte:head><title>Documents · AadOS</title></svelte:head>
<AppShell title="Documents">
<main>
  <header><div><h1>Documents</h1><p>{data.docs.length} document{data.docs.length === 1 ? '' : 's'}{data.status.configured ? ` · stored in RustFS (${data.status.bucket})` : ''}</p></div></header>
  {#if !data.available}<div class="empty">Documents need PostgreSQL storage (AADOS_STORAGE=postgres).</div>
  {:else}
  {#if form && 'error' in form && form.error}<div class="alert">{form.error}</div>{/if}
  {#if !data.status.configured}<div class="note">Uploads are unavailable: {data.status.problem}. <a href="/settings/storage">Settings → Storage</a></div>
  {:else}
  <div class="drop" role="region" aria-label="Upload documents" ondragover={(e) => e.preventDefault()} ondrop={drop}>
    <label class="btn primary">Upload files<input type="file" multiple accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,application/pdf,text/plain,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onchange={pick} hidden></label>
    <input list="folders" bind:value={folder} placeholder="Folder (optional)" maxlength="80" aria-label="Upload folder"><datalist id="folders">{#each data.folders as f (f)}<option value={f}></option>{/each}</datalist>
    <small>or drop files here · PDF, DOCX, TXT, JPG, PNG · up to 25 MB</small>
  </div>
  {#if uploads.length}<ul class="ups">{#each uploads as u, i (i)}<li><span>{u.name}</span>{#if u.error}<em class="err">{u.error}</em>{:else if u.note}<em>{u.note}</em>{:else}<progress max="100" value={u.pct}></progress>{/if}</li>{/each}</ul>{/if}
  {/if}
  <form class="filters" method="GET">
    <input type="search" name="q" value={data.filter.q} placeholder="Search names and contents…" aria-label="Search documents">
    <select name="type" aria-label="Type"><option value="">All types</option>{#each Object.entries(data.types) as [m, t] (m)}<option value={m} selected={data.filter.type === m}>{t.label}</option>{/each}</select>
    <select name="folder" aria-label="Folder"><option value="">All folders</option>{#each data.folders as f (f)}<option selected={data.filter.folder === f}>{f}</option>{/each}</select>
    <input type="date" name="from" value={data.filter.from} aria-label="From"><input type="date" name="to" value={data.filter.to} aria-label="To">
    <button class="btn">Filter</button>{#if data.filter.q || data.filter.type || data.filter.folder || data.filter.from || data.filter.to}<a class="clear" href="/documents">Clear</a>{/if}
  </form>
  <section>{#if data.docs.length === 0}<div class="empty in">{data.filter.q ? 'No documents match.' : 'No documents yet.'}</div>{/if}
    <ul>{#each data.docs as d (d.id)}
      {#if editing === d.id}
      <li class="edit"><form method="POST" action="?/update" use:enhance={() => async ({ update }) => { await update(); editing = ''; }}><input type="hidden" name="id" value={d.id}><input name="filename" value={d.filename} required maxlength="180" aria-label="Name"><input name="folder" value={d.folder} list="folders" placeholder="Folder" maxlength="80" aria-label="Folder"><input name="category" value={d.category} placeholder="Category" maxlength="60" aria-label="Category"><button class="btn">Save</button><button type="button" class="btn" onclick={() => editing = ''}>Cancel</button></form></li>
      {:else}
      <li><span class="type">{label(d.mime)}</span>
        <div><a class="name" href={`/documents/${d.id}`}>{d.filename}</a><small>{size(d.size)} · {new Date(d.createdAt).toLocaleDateString()}{d.folder ? ` · ${d.folder}` : ''}{d.category ? ` · ${d.category}` : ''}{d.sourceType === 'email' ? ' · from email' : ''} · <span class:err={d.extractionStatus === 'failed'}>{STATUS[d.extractionStatus] || d.extractionStatus}</span></small></div>
        <span class="ops"><a class="btn sm" href={`/documents/${d.id}/download`}>Download</a><button type="button" class="btn sm" onclick={() => editing = d.id}>Edit</button><form method="POST" action="?/remove" use:enhance={confirmDelete}><input type="hidden" name="id" value={d.id}><button class="btn sm danger">Delete</button></form></span>
      </li>{/if}{/each}</ul></section>
  {/if}
</main>
</AppShell>
<style>
  main{max-width:1000px}header{margin-bottom:12px}h1{margin:0 0 3px;font-size:22px}header p{margin:0;color:#8a95a8;font-size:12px}
  .alert,.note{padding:9px 14px;border-radius:9px;margin-bottom:10px;font-size:13px}.alert{background:#fff0f1;color:#a5414d}.note{background:#fff4df;color:#8a6420}.note a{color:#8a6420;font-weight:700}
  .btn{border:1px solid #d9dfeb;background:#fff;border-radius:9px;padding:8px 13px;color:#43516c;font-weight:700;cursor:pointer;font-size:13px;text-decoration:none;display:inline-block}.btn:hover{border-color:#8da2f0}.btn.primary{background:#3157de;border-color:#3157de;color:#fff}.btn.sm{padding:4px 9px;font-size:11px}.btn.danger{color:#a5414d}
  .drop{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#fff;border:1px dashed #b9c6f5;border-radius:12px;padding:12px;margin-bottom:10px}.drop input{border:1px solid #e4e9f2;border-radius:9px;padding:8px;font-size:13px}.drop small{color:#8a95a8;font-size:11px}
  .ups{list-style:none;margin:0 0 10px;padding:0;display:grid;gap:4px;font-size:12px}.ups li{display:flex;gap:10px;align-items:center}.ups span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ups em{font-style:normal;color:#0f7f74}.ups progress{width:160px}
  .filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center}.filters input,.filters select{border:1px solid #e4e9f2;border-radius:9px;padding:8px;font-size:13px;background:#fff;min-width:0}.filters input[type=search]{flex:1;min-width:180px}.clear{font-size:12px;color:#3157de;font-weight:700;text-decoration:none}
  section{background:#fff;border:1px solid #e4e9f2;border-radius:12px;overflow:hidden}ul{list-style:none;margin:0;padding:0}
  section li{display:grid;grid-template-columns:62px 1fr auto;gap:10px;align-items:center;padding:10px 14px;border-top:1px solid #eef0f5}section li:first-child{border-top:0}li.edit{display:block}li.edit form{display:flex;gap:6px;flex-wrap:wrap}li.edit input{border:1px solid #e4e9f2;border-radius:8px;padding:7px;font-size:13px;min-width:0;flex:1}
  .type{font-size:10px;font-weight:800;text-transform:uppercase;background:#f0f2f7;color:#5b6a86;border-radius:6px;padding:3px 6px;text-align:center}li div{display:grid;min-width:0}.name{font-weight:600;color:#29344c;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.name:hover{color:#3157de}
  small{color:#8a95a8;font-size:11px}.err{color:#a5414d}.ops{display:flex;gap:4px;align-items:center}.ops form{margin:0}
  .empty{background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:35px;text-align:center;color:#8c96a8}.empty.in{border:0}
  @media(max-width:640px){section li{grid-template-columns:1fr}.ops{flex-wrap:wrap}}
</style>
