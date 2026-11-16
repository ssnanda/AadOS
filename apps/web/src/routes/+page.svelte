<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let searchText = $state('');
  let activeFilter = $state<'All inbox' | 'Unread' | 'Needs reply' | 'Important'>('All inbox');
  let mobileNavigation = $state(false);

  const filters = [
    { label: 'All inbox', symbol: '▣', countKey: 'all' },
    { label: 'Unread', symbol: '◉', countKey: 'unread' },
    { label: 'Needs reply', symbol: '↪', countKey: 'needs_reply' },
    { label: 'Important', symbol: '☆', countKey: 'important' }
  ] as const;

  let visibleMessages = $derived(
    data.messages.filter((message) => {
      const matchesSearch = `${message.sender} ${message.subject} ${message.snippet}`.toLowerCase().includes(searchText.trim().toLowerCase());
      const matchesFilter = activeFilter === 'All inbox'
        || (activeFilter === 'Unread' && message.unread)
        || (activeFilter === 'Needs reply' && message.needs_reply)
        || (activeFilter === 'Important' && message.important);
      return matchesSearch && matchesFilter;
    })
  );
</script>

<svelte:head>
  <title>Inbox · AadOS</title>
  <meta name="description" content="AadOS personal email command center" />
</svelte:head>

<div class="workspace">
  <aside class:expanded={mobileNavigation} class="sidebar" aria-label="Primary navigation">
    <div class="brand"><span class="brand-mark">a</span><span>Aad<span class="brand-os">OS</span><small>PERSONAL OS</small></span></div>
    <div class="nav-active"><span class="nav-icon">✉</span><span>Inbox</span><span class="nav-count">{data.overview.counts.all}</span></div>
    <a class="nav-muted" href="/emails"><span class="nav-icon">▧</span><span>Emails</span></a>
    <div class="nav-heading accounts-heading">CONNECTED ACCOUNTS</div>
    {#if data.overview.accounts.length === 0}
      <div class="no-accounts"><span class="empty-account-icon">◎</span><span>No accounts yet</span></div>
    {:else}
      {#each data.overview.accounts as account (account.id)}
        <div class="account-row"><span class="account-avatar">{account.provider === 'gmail' ? 'G' : account.provider === 'zoho' ? 'Z' : 'M'}</span><span class="account-email">{account.address}</span></div>
      {/each}
    {/if}
  </aside>

  <main class="main">
    <header class="topbar">
      <button class="mobile-menu" onclick={() => mobileNavigation = !mobileNavigation} aria-label="Toggle navigation">☰</button>
      <div class="breadcrumb"><strong>Inbox</strong></div>
      <div class="topbar-right"><span class:offline={data.apiStatus === 'offline'} class="api-indicator"></span><span class="api-text">API {data.apiStatus}</span><a class="pipelines-link" href="/settings">Settings</a><form method="POST" action="/logout"><button class="signout" type="submit">Sign out</button></form><span class="avatar">A</span></div>
    </header>

    <div class="content">
      {#if data.apiStatus === 'offline'}
        <div class="status-alert" role="status"><span class="status-alert-icon">!</span><span>The AadOS API is offline. Start the Phoenix backend to retrieve live connection status. Mailbox data is not available.</span></div>
      {/if}

      <div class="columns single">
        <section class="inbox-panel" aria-labelledby="inbox-title">
          <div class="panel-header"><h2 id="inbox-title">Inbox</h2><span class="readonly-badge"><span>●</span> Read-only</span></div>
          <div class="searchbox"><span class="search-symbol">⌕</span><input type="search" bind:value={searchText} placeholder="Search across your inbox..." aria-label="Search across connected inboxes" /><span class="search-key">SEARCH</span></div>
          <div class="filters" role="group" aria-label="Filter messages">
            {#each filters as filter}
              <button class:active={activeFilter === filter.label} onclick={() => activeFilter = filter.label}><span>{filter.symbol}</span>{filter.label}<span class="filter-count">{data.overview.counts[filter.countKey]}</span></button>
            {/each}
          </div>
          {#if visibleMessages.length === 0}
            <div class="inbox-empty">
              {#if data.overview.accounts.length === 0}
                <h3>No email accounts connected</h3><p>Connect Zoho or Gmail in Email settings.</p><a class="empty-cta" href="/settings/emails">Open Email settings</a>
              {:else if searchText.trim() !== ''}
                <h3>No matching messages</h3><p>Try another search to find your email.</p>
              {:else}
                <h3>All clear for now</h3><p>No emails match this filter.</p>
              {/if}
            </div>
          {:else}
            <div class="message-list">{#each visibleMessages as message (message.id)}<article class:unread={message.unread} class="message"><div class="message-sender">{message.sender}</div><h3>{message.subject}</h3><p>{message.snippet}</p><span>{message.category}</span></article>{/each}</div>
          {/if}
          <div class="panel-foot"><span>{visibleMessages.length} shown · {data.overview.counts.all} synced</span></div>
        </section>

      </div>
    </div>
  </main>
</div>

<style>
  .workspace{display:flex;min-height:100vh;color:#283044}.sidebar{width:246px;flex-shrink:0;background:#fff;border-right:1px solid #e9ecf4;display:flex;flex-direction:column;padding:31px 17px 22px;min-height:100vh}.brand{display:flex;align-items:center;gap:12px;padding:0 11px 36px;font-weight:780;font-size:25px;letter-spacing:-1.5px;line-height:1}.brand-mark{height:37px;width:37px;display:grid;place-items:center;background:#3157de;color:#fff;border-radius:12px;font-size:25px;font-weight:700;letter-spacing:-2px;padding-right:2px}.brand-os{color:#4264e7}.brand small{display:block;color:#929bb2;letter-spacing:2px;font-size:8px;margin-top:7px;font-weight:700}.workspace-label{margin:0 13px 32px;color:#a3adbf;font-size:10px;font-weight:750;letter-spacing:1.9px}.nav-heading{padding:0 13px 12px;color:#a3adbf;font-size:10px;font-weight:750;letter-spacing:1.1px}.nav-active,.nav-muted{height:43px;display:flex;gap:12px;align-items:center;padding:0 13px;border-radius:10px;font-size:13px;font-weight:650;margin-bottom:5px}.nav-active{background:#edf1ff;color:#3159dd}.nav-muted{color:#8c96a9}.nav-icon{font-size:19px;width:20px;text-align:center;font-weight:500}.nav-count{margin-left:auto;font-size:11px;font-weight:750;background:white;border-radius:6px;padding:4px 8px}.soon{margin-left:auto;font-size:10px;font-weight:500}.accounts-heading{margin-top:43px}.no-accounts,.account-row{margin:2px 13px;color:#9ba5b5;display:flex;align-items:center;gap:9px;font-size:12px}.empty-account-icon{font-size:18px}.account-avatar{background:#eef2ff;border-radius:6px;padding:7px}.account-email{overflow:hidden;text-overflow:ellipsis}.sidebar-bottom{margin-top:auto;display:flex;align-items:center;gap:9px;border-top:1px solid #f0f1f6;padding:20px 12px 0;font-size:11px}.sidebar-bottom strong,.sidebar-bottom small{display:block}.sidebar-bottom small{color:#9aa4b6;margin-top:4px}.privacy-dot{height:30px;width:30px;border-radius:9px;background:#e8f8ed;display:grid;place-items:center}.privacy-dot:after{content:'✓';font-size:15px;color:#41ad6c}.main{flex:1;min-width:0}.topbar{height:75px;background:#fff;border-bottom:1px solid #e9ecf4;display:flex;align-items:center;justify-content:space-between;padding:0 37px}.breadcrumb{color:#9aa3b3;font-size:12px}.breadcrumb span{padding:0 10px;color:#c4cad5}.breadcrumb strong{color:#3e4860}.topbar-right{display:flex;align-items:center;gap:9px;color:#858fa1;font-size:11px}.api-indicator{height:7px;width:7px;background:#35ba7d;border-radius:50%}.api-indicator.offline{background:#e2a143}.avatar{height:34px;width:34px;border-radius:50%;display:grid;place-items:center;background:#dbe3ff;color:#3658cc;margin-left:22px;font-size:13px;font-weight:750}.content{max-width:1450px;margin:auto;padding:42px 37px 45px}.welcome-row{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:41px}.eyebrow{color:#7788af;font-size:10px;font-weight:800;letter-spacing:2.1px;margin-bottom:12px}h1{margin:0;color:#253047;font-size:30px;font-weight:780;letter-spacing:-1.15px;line-height:1.2}h1 span{color:#4162e8}.welcome-row p{font-size:13px;color:#8893a7;margin:9px 0 0}.release-label{color:#98a3b5;font-size:12px;white-space:nowrap}.release-label span{font-weight:700;color:#6880c1}.status-alert{padding:12px 16px;background:#fff7e9;color:#94682c;border:1px solid #f2e4c9;border-radius:10px;font-size:12px;display:flex;gap:12px;align-items:center;margin:-17px 0 28px}.status-alert-icon{font-weight:800}.section-label{display:flex;gap:15px;align-items:center;color:#94a0b7;font-size:10px;font-weight:760;letter-spacing:1.6px;margin-bottom:17px}.section-line{flex:1;height:1px;background:#e8ebf3}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:17px;margin-bottom:30px}.stat-card{background:#fff;border:1px solid #e9edf6;box-shadow:0 3px 20px #33447d06;border-radius:14px;padding:19px 21px 20px;min-height:141px}.stat-top{display:flex;justify-content:space-between;align-items:center}.stat-icon{display:grid;place-items:center;width:35px;height:35px;border-radius:10px;font-size:21px}.lavender{color:#6854d9;background:#efedff}.blue{color:#387de0;background:#e8f1ff}.amber{color:#c48c34;background:#fff4df}.rose{color:#d56c91;background:#ffedf4}.stat-trend{font-size:9px;font-weight:700;letter-spacing:.9px;color:#a6afbe}.stat-value{font-size:29px;font-weight:800;margin-top:14px;line-height:1;color:#26314b}.stat-desc{font-size:11px;color:#9da6b7;margin-top:8px}.columns{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:21px;align-items:start}.inbox-panel,.connect-panel,.ai-panel{background:#fff;border:1px solid #e9edf5;border-radius:14px;box-shadow:0 3px 20px #33447d06}.inbox-panel{min-height:560px}.panel-header{display:flex;align-items:center;justify-content:space-between;padding:23px 24px 18px}.panel-overline{font-size:9px;color:#99a7c4;font-weight:760;letter-spacing:1.4px;margin-bottom:7px}.panel-header h2{font-size:20px;font-weight:780;letter-spacing:-.55px;margin:0}.readonly-badge{background:#edf8f0;color:#44a469;border-radius:20px;font-size:10px;padding:7px 10px;font-weight:700}.readonly-badge span{font-size:8px;margin-right:5px}.searchbox{display:flex;align-items:center;height:41px;background:#f7f8fb;border:1px solid #edf0f5;margin:0 24px 17px;border-radius:9px;padding:0 12px;gap:9px}.searchbox input{border:0;outline:0;min-width:0;flex:1;color:#384561;background:transparent;font-size:12px}.searchbox input::placeholder{color:#a2abbb}.search-symbol{color:#98a4b7;font-size:23px}.search-key{font-size:9px;letter-spacing:.8px;color:#aeb7c6}.filters{display:flex;gap:5px;align-items:center;border-bottom:1px solid #edf0f6;padding:0 20px;overflow-x:auto}.filters button{display:flex;gap:8px;align-items:center;white-space:nowrap;border:0;border-bottom:2px solid transparent;background:none;color:#98a2b2;font-size:11px;padding:13px 10px 13px;font-weight:650}.filters button.active{color:#3e60d9;border-bottom-color:#4668e7}.filters button>span:first-child{font-size:15px}.filter-count{background:#f0f2f7;border-radius:5px;padding:2px 6px;font-size:9px;color:#9ca6b8}.filters button.active .filter-count{color:#4465e5;background:#edf1ff}.inbox-empty{min-height:320px;display:flex;align-items:center;flex-direction:column;justify-content:center;text-align:center;padding:22px 35px 37px}.empty-illustration{width:115px;height:110px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle,#f0f3ff 50%,#fafbff 72%);position:relative}.mail-envelope{font-size:52px;color:#6681e4;transform:rotate(-5deg)}.floating-sparkle{position:absolute;color:#adc0fa}.floating-sparkle.one{top:17px;right:2px}.floating-sparkle.two{bottom:18px;left:2px}.inbox-empty h3{margin:8px 0 9px;font-size:17px;color:#39445c;letter-spacing:-.3px}.inbox-empty p{font-size:12px;color:#98a3b5;line-height:1.7;max-width:340px;margin:0}.empty-cta{border:1px solid #dbe3f8;color:#8899c9;background:#f7f9ff;padding:11px 15px;border-radius:8px;font-size:11px;font-weight:750;margin-top:22px}.panel-foot{display:flex;justify-content:space-between;gap:12px;color:#aab2c1;border-top:1px solid #edf0f6;padding:15px 24px;font-size:10px}.message-list{padding:8px 22px}.message{border-bottom:1px solid #eef0f5;padding:13px 2px}.message.unread{background:#f8faff}.message h3{font-size:13px;margin:5px 0}.message p{font-size:12px;color:#9aa4b3;margin:0 0 6px}.message span,.message-sender{font-size:10px;color:#8492b0}.right-column{display:flex;flex-direction:column;gap:19px}.connect-panel{padding:22px}.connect-icon{height:38px;width:38px;border-radius:12px;display:grid;place-items:center;background:#eaf0ff;color:#4567e4;font-size:23px}.connect-panel h2{font-size:17px;margin:15px 0 8px;letter-spacing:-.4px}.connect-panel>p,.ai-panel p{color:#96a1b4;font-size:11px;line-height:1.7;margin:0 0 20px}.provider{display:flex;align-items:center;border:1px solid #edf0f6;border-radius:9px;padding:11px 10px;gap:10px;margin-bottom:9px}.provider-logo{width:31px;height:31px;border-radius:7px;display:grid;place-items:center;font-size:17px;font-weight:780}.google-logo{background:#fff1ef;color:#e65b52}.microsoft-logo{background:#e7f3ff;color:#388bd1;font-size:23px}.provider>div{display:flex;flex-direction:column;gap:4px}.provider strong{font-size:11px;color:#465068}.provider small{font-size:10px;color:#a3adbe}.provider-tag{margin-left:auto;white-space:nowrap;color:#98a4b7;font-size:9px}.safe-note{border-top:1px solid #eef0f5;padding-top:15px;margin-top:17px;color:#a0abbb;font-size:10px;line-height:1.7;display:flex;gap:9px}.safe-note span{font-size:15px;color:#57b685}.ai-panel{padding:21px;background:linear-gradient(140deg,#f9faff,#f2f5ff);border-color:#e4e9fa}.ai-top{display:flex;align-items:center;gap:10px;margin-bottom:15px}.ai-icon{height:32px;width:32px;background:#e6eaff;border-radius:9px;display:grid;place-items:center;color:#5d6ee0}.ai-label{color:#9aa7c6;letter-spacing:1.3px;font-size:9px;font-weight:750}.ai-panel h3{font-size:16px;margin:0 0 8px;letter-spacing:-.3px}.ai-status{display:inline-block;border-radius:7px;background:#e4eafc;color:#6679b5;font-size:10px;padding:7px 11px;font-weight:700}.version-note{text-align:center;font-size:10px;color:#acb4c2}.version-note strong{color:#7a8dbd}
  .mobile-menu{display:none;border:0;background:transparent;color:#4b5e86;font-size:19px}
  .topbar-right form{margin:0 0 0 12px}.signout,.pipelines-link{border:0;background:transparent;color:#6f7c94;font-size:11px;padding:7px;text-decoration:none}.signout:hover,.pipelines-link:hover{color:#3157de}
  @media(max-width:1150px){.columns{grid-template-columns:minmax(0,1fr) 250px}.sidebar{width:217px}.content{padding:35px 25px}.topbar{padding:0 25px}.stats{gap:10px}.stat-card{padding:15px}.stat-trend{font-size:8px}.right-column{gap:12px}}
  @media(max-width:900px){.sidebar{position:fixed;z-index:20;transform:translateX(-100%);transition:transform .2s;height:100%;box-shadow:10px 0 25px #151c2d18}.sidebar.expanded{transform:translateX(0)}.mobile-menu{display:inline-block}.topbar{gap:14px;justify-content:flex-start}.topbar-right{margin-left:auto}.columns{grid-template-columns:1fr}.right-column{display:grid;grid-template-columns:1fr 1fr;align-items:start}.version-note{display:none}}
  @media(max-width:620px){.content{padding:25px 14px}.topbar{height:62px;padding:0 15px}.api-text{display:none}.welcome-row{margin-bottom:30px}.welcome-row h1{font-size:25px}.welcome-row p{max-width:270px}.release-label{display:none}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.stat-card{min-height:119px}.columns{gap:14px}.right-column{grid-template-columns:1fr}.panel-header{padding:18px}.searchbox{margin:0 18px 12px}.filters{padding:0 10px}.panel-foot{flex-direction:column}.inbox-empty{padding-left:20px;padding-right:20px}}
  .nav-muted{text-decoration:none}
  .columns.single{grid-template-columns:minmax(0,1fr)}
  a.empty-cta{text-decoration:none}
</style>
