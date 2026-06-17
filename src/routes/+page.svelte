<script lang="ts">
  type Source = { id: string; api: string; query: string; enabled: boolean };
  type Plan = { dimensions: { key: string; label: string; enabled: boolean; sources: Source[] }[] };

  let question = $state('');
  let runId = $state<string | null>(null);
  let plan = $state<Plan | null>(null);
  let phase = $state('idle');
  let log = $state<string[]>([]);
  let markdown = $state('');
  let reportPath = $state('');
  let models = $state<{ models: string[]; defaults: { fanout: string; synth: string } } | null>(null);
  let fanoutModel = $state('');
  let synthModel = $state('');

  async function loadModels() {
    const r = await fetch('/api/models');
    models = await r.json();
    fanoutModel = models!.defaults.fanout;
    synthModel = models!.defaults.synth;
  }
  loadModels();

  function listen(id: string) {
    const es = new EventSource(`/api/run/${id}/stream`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.phase === 'heartbeat') return;
      phase = e.phase;
      if (e.phase === 'awaiting_edit') plan = e.plan;
      else if (e.phase === 'querying') log = [...log, `${e.status}: ${e.title ?? e.sourceId}`];
      else if (e.phase === 'awaiting_deposit') markdown = e.markdown;
      else if (e.phase === 'done') { reportPath = e.reportPath; es.close(); }
      else if (e.phase === 'error') { log = [...log, `ERROR: ${e.message}`]; es.close(); }
    };
  }

  async function start() {
    const r = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, fanoutModel, synthModel })
    });
    if (!r.ok) { phase = 'error'; log = [...log, `start failed: ${r.status}`]; return; }
    const data = await r.json();
    runId = data.id;
    plan = data.plan;
    phase = data.status;
    listen(data.id);
  }

  async function runIt() {
    log = [];
    await fetch(`/api/run/${runId}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan })
    });
  }

  async function deposit() {
    await fetch(`/api/run/${runId}/deposit`, { method: 'POST' });
  }

  function addSource() {
    plan!.dimensions[0].sources.push({
      id: `web-${plan!.dimensions[0].sources.length + 1}`,
      api: 'tavily', query: '', enabled: true
    });
  }
  function removeSource(i: number) {
    plan!.dimensions[0].sources.splice(i, 1);
  }
</script>

<main style="max-width: 820px; margin: 2rem auto; font-family: system-ui; padding: 0 1rem;">
  <h1>Universal Search</h1>

  {#if models}
    <div style="display:flex; gap:1rem; font-size:.85rem; color:#555;">
      <label>Fanout
        <select bind:value={fanoutModel}>{#each models.models as m}<option>{m}</option>{/each}</select>
      </label>
      <label>Synthesis
        <select bind:value={synthModel}>{#each models.models as m}<option>{m}</option>{/each}</select>
      </label>
    </div>
  {/if}

  <textarea bind:value={question} placeholder="提出你的问题…" rows="3" style="width:100%; margin:1rem 0;"></textarea>
  <button onclick={start} disabled={!question.trim()}>提出问题 → 生成搜索计划</button>

  <p>状态：<strong>{phase}</strong></p>

  {#if plan && phase === 'awaiting_edit'}
    <h2>搜索计划（可增删改）</h2>
    {#each plan.dimensions[0].sources as s, i}
      <div style="display:flex; gap:.5rem; margin:.25rem 0;">
        <input type="checkbox" bind:checked={s.enabled} />
        <input bind:value={s.query} style="flex:1;" />
        <button onclick={() => removeSource(i)}>✕</button>
      </div>
    {/each}
    <button onclick={addSource}>+ 加一个源</button>
    <button onclick={runIt} style="margin-left:1rem;">按计划搜索 →</button>
  {/if}

  {#if log.length}
    <h3>进度</h3>
    <ul>{#each log as line}<li>{line}</li>{/each}</ul>
  {/if}

  {#if markdown && phase === 'awaiting_deposit'}
    <h2>报告预览</h2>
    <pre style="white-space:pre-wrap; background:#f6f6f6; padding:1rem;">{markdown}</pre>
    <button onclick={deposit}>确认沉淀进第二大脑 →</button>
  {/if}

  {#if phase === 'done'}
    <p>✅ 已沉淀：<code>{reportPath}</code></p>
  {/if}
</main>
