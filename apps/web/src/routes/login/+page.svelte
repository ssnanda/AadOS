<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Sign in · AadOS</title></svelte:head>

<main class="login-shell">
  <form method="POST" class="login-card">
    <input type="hidden" name="csrfToken" value={data.csrfToken} />
    <div class="brand"><span>a</span><strong>Aad<span>OS</span></strong></div>
    <h1>Welcome back</h1>
    <p>Sign in to your personal workspace.</p>
    {#if form?.error}<div class="error" role="alert">{form.error}</div>{/if}
    <label>Username<input name="username" autocomplete="username" value={form?.username || ''} required /></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
    <button type="submit">Sign in</button>
  </form>
</main>

<style>
  .login-shell{min-height:100vh;display:grid;place-items:center;padding:24px;background:#f6f7fb}.login-card{width:min(100%,370px);background:#fff;border:1px solid #e5e9f2;border-radius:16px;padding:29px;box-shadow:0 14px 45px #26365d12}.brand{display:flex;align-items:center;gap:10px;margin-bottom:28px;color:#26314b}.brand>span{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:#3157de;color:#fff;font-size:24px;font-weight:750}.brand strong{font-size:21px}.brand strong span{color:#4264e7}h1{font-size:23px;margin:0 0 7px;color:#26314b}p{margin:0 0 24px;color:#8b96aa;font-size:13px}label{display:grid;gap:7px;margin-top:14px;color:#536078;font-size:12px;font-weight:700}input{width:100%;border:1px solid #dce2ed;border-radius:9px;padding:11px 12px;color:#29344c;background:#fbfcfe}button{width:100%;border:0;border-radius:9px;background:#3157de;color:#fff;padding:12px;margin-top:21px;font-weight:750}.error{background:#fff0f1;color:#a83e49;border:1px solid #f1d1d5;border-radius:8px;padding:10px 12px;font-size:12px;margin-bottom:15px}
</style>
