<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';

	type Source = { id: string; api: string; query: string; enabled: boolean };
	type Plan = { dimensions: { key: string; label: string; enabled: boolean; sources: Source[] }[] };
	type Models = { models: string[]; defaults: { fanout: string; synth: string }; baseURL?: string };
	type DepositFile = { path: string; kind: string };

	// run state
	let question = $state('');
	let runId = $state<string | null>(null);
	let plan = $state<Plan | null>(null);
	let phase = $state('idle');
	let sourceStatus = $state<Record<string, { title: string; status: string }>>({});
	let markdown = $state('');
	let depositFiles = $state<DepositFile[]>([]);
	let reportPath = $state('');
	let errorMsg = $state('');
	let depositing = $state(false);
	let es: EventSource | null = null;

	// ui state
	let mode = $state('light');
	let settingsOpen = $state(false);
	let reportView = $state<'preview' | 'source'>('preview');

	// models
	let models = $state<Models | null>(null);
	let fanoutModel = $state('');
	let synthModel = $state('');

	onMount(() => {
		mode = document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light';
		loadModels();
	});

	async function loadModels() {
		try {
			const r = await fetch('/api/models');
			if (!r.ok) return;
			models = await r.json();
			fanoutModel = models!.defaults.fanout;
			synthModel = models!.defaults.synth;
		} catch {
			/* selectors stay empty; not fatal */
		}
	}

	function toggleMode() {
		mode = mode === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.mode = mode;
		try {
			localStorage.setItem('us-mode', mode);
		} catch {
			/* private mode etc. */
		}
	}

	const providerHost = $derived((models?.baseURL ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
	const sourceChips = $derived(Object.values(sourceStatus));
	const rawCount = $derived(depositFiles.filter((f) => f.kind === 'raw').length);
	const willWritePath = $derived(depositFiles.find((f) => f.kind === 'synthesis')?.path ?? '');
	const renderedReport = $derived(
		markdown && browser ? DOMPurify.sanitize(marked.parse(markdown) as string) : ''
	);

	const order = ['proposing', 'awaiting_edit', 'searching', 'synthesizing', 'awaiting_deposit', 'depositing', 'done'];
	const idx = (p: string) => order.indexOf(p);
	function step(target: string): 'done' | 'run' | 'wait' {
		if (phase === target) return 'run';
		return idx(phase) > idx(target) ? 'done' : 'wait';
	}
	const working = $derived(phase === 'searching' || phase === 'synthesizing' || phase === 'depositing');

	function resetRun() {
		es?.close();
		es = null;
		runId = null;
		plan = null;
		phase = 'idle';
		sourceStatus = {};
		markdown = '';
		depositFiles = [];
		reportPath = '';
		errorMsg = '';
		depositing = false;
	}

	function listen(id: string) {
		es?.close();
		es = new EventSource(`/api/run/${id}/stream`);
		es.onmessage = (m) => {
			const e = JSON.parse(m.data);
			if (e.phase === 'heartbeat') return;
			if (phase === 'done') return; // don't let a late event downgrade a finished run
			if (e.phase === 'querying') {
				// 'querying' is the search-in-progress signal (the main work). Keep the UI
				// in the 'searching' phase so the timeline + per-source chips stay visible,
				// and only update the per-source status — never flip phase to 'querying'
				// (which would drop out of `working` and blank the screen).
				phase = 'searching';
				sourceStatus = { ...sourceStatus, [e.sourceId]: { title: e.title ?? e.sourceId, status: e.status } };
				return;
			}
			phase = e.phase;
			if (e.phase === 'awaiting_edit') plan = e.plan;
			else if (e.phase === 'awaiting_deposit') {
				markdown = e.markdown;
				depositFiles = e.files ?? [];
			} else if (e.phase === 'done') {
				reportPath = e.reportPath;
				es?.close();
			} else if (e.phase === 'error') {
				errorMsg = e.message;
				es?.close();
			}
		};
	}

	async function start() {
		if (!question.trim()) return;
		resetRun();
		phase = 'proposing';
		settingsOpen = false;
		let r: Response;
		try {
			r = await fetch('/api/run', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ question, fanoutModel, synthModel })
			});
		} catch {
			phase = 'error';
			errorMsg = '无法连接本地服务';
			return;
		}
		if (!r.ok) {
			phase = 'error';
			errorMsg = `启动失败：HTTP ${r.status}`;
			return;
		}
		const data = await r.json();
		runId = data.id;
		plan = data.plan;
		phase = data.status;
		if (data.status === 'error') {
			errorMsg = data.error ?? '启动失败';
			return;
		}
		listen(data.id);
	}

	async function runIt() {
		sourceStatus = {};
		markdown = '';
		reportPath = '';
		errorMsg = '';
		// Optimistically enter the search UI immediately: the backend sets status to
		// 'searching' but emits no 'searching' event (the first event is 'querying'),
		// so without this the editor would linger and the timeline would stay hidden
		// until the first source returns — looking like nothing happened.
		phase = 'searching';
		try {
			await fetch(`/api/run/${runId}/plan`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ plan })
			});
		} catch {
			phase = 'error';
			errorMsg = '无法连接本地服务';
		}
	}

	async function deposit() {
		if (depositing) return;
		depositing = true;
		await fetch(`/api/run/${runId}/deposit`, { method: 'POST' });
	}

	const DIM_API = { web: 'tavily', peoples_writing: 'exa', community: 'community', images: 'unsplash' } as const;
	function addSource(di: number) {
		const dim = plan!.dimensions[di];
		dim.sources.push({
			id: `${dim.key}-${dim.sources.length + 1}`,
			api: DIM_API[dim.key as keyof typeof DIM_API] ?? 'tavily',
			query: '',
			enabled: true
		});
	}
	function removeSource(di: number, i: number) {
		plan!.dimensions[di].sources.splice(i, 1);
	}
</script>

<div class="wrap">
	<div class="app">
		<div class="topbar">
			<div class="brand">
				<span class="mark"><i class="ph ph-magnifying-glass"></i></span> 万能搜索
				<span class="sub">/ 搜索并沉淀知识</span>
			</div>
			<div class="tools">
				<button class="iconbtn" onclick={toggleMode} title="深 / 浅" aria-label="切换深浅模式">
					<i class="ph {mode === 'dark' ? 'ph-sun' : 'ph-moon'}"></i>
				</button>
				<div class="pop-anchor">
					<button class="iconbtn" class:active={settingsOpen} onclick={() => (settingsOpen = !settingsOpen)} title="模型设置" aria-label="模型设置">
						<i class="ph ph-gear-six"></i>
					</button>
					{#if settingsOpen}
						<button
							onclick={() => (settingsOpen = false)}
							aria-label="关闭设置"
							style="position:fixed;inset:0;z-index:20;background:transparent;border:none;cursor:default"
						></button>
						<div class="pop">
							<h3><i class="ph ph-gear-six"></i> 模型设置</h3>
							<p class="note">一般无需频繁调整，默认值来自 .env。</p>
							{#if providerHost}
								<div class="provider">提供商主机 <b>{providerHost}</b></div>
							{/if}
							<div class="grp">
								<label class="fld" for="fanout">铺广度模型（便宜 · 提查询/压缩/打标签）</label>
								<div class="selrow">
									<select id="fanout" bind:value={fanoutModel}>
										{#each models?.models ?? [] as m}<option value={m}>{m}</option>{/each}
									</select>
									<i class="ph ph-caret-down caret"></i>
								</div>
							</div>
							<div class="grp">
								<label class="fld" for="synth">收口模型（强 · 综合报告）</label>
								<div class="selrow">
									<select id="synth" bind:value={synthModel}>
										{#each models?.models ?? [] as m}<option value={m}>{m}</option>{/each}
									</select>
									<i class="ph ph-caret-down caret"></i>
								</div>
							</div>
							<button class="btn btn-soft" style="width:100%;justify-content:center" onclick={() => (settingsOpen = false)}>完成</button>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="body">
			<label class="fld" for="q">想了解点什么？</label>
			<textarea id="q" rows="2" bind:value={question} placeholder="提出你的问题…"></textarea>
			<div class="toolbar-between" style="margin-top:12px">
				<span class="dim">维度可编辑</span>
				<button class="btn btn-primary" onclick={start} disabled={!question.trim() || phase === 'proposing'}>
					{#if phase === 'proposing'}<span class="spin"></span> 生成中…{:else}生成搜索计划 <i class="ph ph-arrow-right"></i>{/if}
				</button>
			</div>

			<!-- 搜索计划（可编辑） -->
			{#if plan && phase === 'awaiting_edit'}
				<div class="plan-head">
					<h2>搜索计划</h2>
					<span class="dim">勾选启用 · 直接改写查询 · 可增删</span>
				</div>
				{#each plan.dimensions as dim, di (dim.key)}
					<div class="dim-group" style={dim.enabled ? '' : 'opacity:.55'}>
						<div class="dim-head">
							<button class="tgl" class:off={!dim.enabled} onclick={() => (dim.enabled = !dim.enabled)} aria-label="启用或停用此维度"></button>
							<span class="dim-name">{dim.label}</span>
							<span class="dim">{dim.sources.length} 个源</span>
						</div>
						{#each dim.sources as s, i (s.id)}
							<div class="src">
								<i class="ph ph-dots-six-vertical grip"></i>
								<button class="tgl" class:off={!s.enabled} onclick={() => (s.enabled = !s.enabled)} aria-label="启用或停用此源"></button>
								<input type="text" bind:value={s.query} style={s.enabled ? '' : 'color:var(--ink-3)'} />
								<span class="badge-api">{s.api}</span>
								<button class="del" onclick={() => removeSource(di, i)} aria-label="删除"><i class="ph ph-x"></i></button>
							</div>
						{/each}
						<button class="btn btn-ghost" onclick={() => addSource(di)}><i class="ph ph-plus"></i> 添加搜索源</button>
					</div>
				{/each}
				<div class="toolbar-between">
					<span class="dim"></span>
					<button class="btn btn-primary" onclick={runIt}>开始搜索 <i class="ph ph-arrow-right"></i></button>
				</div>
			{/if}

			<!-- 执行中：时间线 -->
			{#if working}
				<ul class="tl" style="margin-top:22px">
					<li>
						<span class="dot done"><i class="ph ph-check"></i></span>
						<div class="t">提出搜索计划</div>
						<div class="m">已生成查询，你已编辑确认</div>
					</li>
					<li>
						<span class="dot {step('searching')}">{#if step('searching') === 'done'}<i class="ph ph-check"></i>{/if}</span>
						<div class="t">并行搜索 + 逐源压缩</div>
						{#if sourceChips.length}
							<div class="chips">
								{#each sourceChips as c}
									<span class="chip {c.status === 'ok' ? 'ok' : c.status === 'fail' ? 'fail' : 'run'}">
										{#if c.status === 'ok'}<i class="ph ph-check-circle"></i>{:else if c.status === 'fail'}<i class="ph ph-warning-circle"></i>{:else}<span class="spin"></span>{/if}
										{c.title}
									</span>
								{/each}
							</div>
						{/if}
					</li>
					<li>
						<span class="dot {step('synthesizing')}">{#if step('synthesizing') === 'done'}<i class="ph ph-check"></i>{:else}3{/if}</span>
						<div class="t">综合报告</div>
						<div class="m">{phase === 'synthesizing' ? '强模型整理中…' : '等待证据就绪'}</div>
					</li>
					<li>
						<span class="dot {phase === 'depositing' ? 'run' : 'wait'}">4</span>
						<div class="t">沉淀进第二大脑</div>
						<div class="m">需你确认后写入</div>
					</li>
				</ul>
			{/if}

			<!-- 报告：预览 / 源码 -->
			{#if (phase === 'awaiting_deposit' || phase === 'done') && markdown}
				<div class="row" style="justify-content:space-between;margin-top:22px">
					<div class="seg">
						<button class:on={reportView === 'preview'} onclick={() => (reportView = 'preview')}><i class="ph ph-article"></i> 预览</button>
						<button class:on={reportView === 'source'} onclick={() => (reportView = 'source')}><i class="ph ph-code"></i> Markdown 源码</button>
					</div>
					<span class="dim">{rawCount} 条来源</span>
				</div>
				<div class="report">
					<div class="meta">
						<span class="pill">type: synthesis</span>
						<span class="pill">{rawCount} 条来源</span>
						<span style="margin-left:auto">将写入 second brain</span>
					</div>
					{#if reportView === 'preview'}
						<div class="doc">{@html renderedReport}</div>
					{:else}
						<pre class="src-code">{markdown}</pre>
					{/if}
				</div>

				{#if phase === 'awaiting_deposit'}
					<div class="deposit-bar">
						<div>
							<div class="where">将写入 <code>{willWritePath}</code></div>
							<div class="note-line warn" style="margin-top:4px">
								<i class="ph ph-info"></i> 沉淀前请确保 vault 工作区干净，否则会安全中止
							</div>
						</div>
						<button class="btn btn-primary" onclick={deposit} disabled={depositing}>
							{#if depositing}<span class="spin"></span> 沉淀中…{:else}<i class="ph ph-tray-arrow-down"></i> 确认沉淀进第二大脑{/if}
						</button>
					</div>
				{/if}
			{/if}

			<!-- 完成 -->
			{#if phase === 'done'}
				<div class="done-banner">
					<i class="ph ph-check-circle"></i> 已沉淀：<code>{reportPath}</code>
				</div>
			{/if}

			<!-- 出错 -->
			{#if phase === 'error'}
				<div class="deposit-bar warn" style="margin-top:18px">
					<div class="note-line warn"><i class="ph ph-warning-circle"></i> {errorMsg || '出错了'}</div>
				</div>
			{/if}
		</div>
	</div>
</div>
