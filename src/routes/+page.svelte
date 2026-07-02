<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import GithubMode from '$lib/GithubMode.svelte';
	import ReportResult from '$lib/ReportResult.svelte';
	import QuickSearchMode from '$lib/QuickSearchMode.svelte';
	import ChannelSettings from '$lib/ChannelSettings.svelte';
	import OnboardingWizard from '$lib/OnboardingWizard.svelte';

	type CommunityTarget = { kind: 'subreddit' | 'hn' | 'domain' | 'web' | 'writing'; value: string };
	type Source = {
		id: string;
		api: string;
		query: string;
		enabled: boolean;
		target?: CommunityTarget;
		label?: string;
		scoreLabel?: string;
		score?: number;
	};
	type Plan = { dimensions: { key: string; label: string; enabled: boolean; sources: Source[] }[] };
	type Models = {
		models: string[];
		defaults: { fanout: string; synth: string };
		baseURL?: string;
		needsSetup?: boolean;
	};
	type Channel = { id: string; name: string; baseURL: string };
	type DepositFile = { path: string; kind: string };
	type SearchMode = 'report' | 'github' | 'quick';
	type QuickResult = { url: string; title: string; snippet: string; publishedAt?: string };
	type Repo = {
		url: string;
		fullName: string;
		description: string;
		stars: number;
		language?: string;
		license?: string;
		pushedAt?: string;
		topics?: string[];
		reputation: number;
		score: number;
		reason: string;
	};

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
	let channelsOpen = $state(false);
	let onboardingOpen = $state(false);
	let reportView = $state<'preview' | 'source'>('preview');

	// save directory (where reports/workflows are written — replaces the hard-coded vault)
	let saveDir = $state('');
	let saveDirInput = $state('');
	let savingDir = $state(false);
	let saveDirMsg = $state('');
	let saveDirOk = $state<boolean | null>(null);

	// information-source region (国内/国外/混合) — biases dimension proposal + community/site picking
	let sourceRegion = $state<'domestic' | 'foreign' | 'mixed'>('mixed');
	let regionMsg = $state('');

	// search mode (report ↔ github tool search ↔ quick web search)
	let searchMode = $state<SearchMode>('report');
	let repos = $state<Repo[]>([]);

	// quick search (plain search-engine pass — synchronous, no run/SSE)
	// null = not searched yet; [] = searched, no results
	let quickResults = $state<QuickResult[] | null>(null);
	let quickLoading = $state(false);

	// models
	let models = $state<Models | null>(null);
	let fanoutModel = $state('');
	let synthModel = $state('');
	let needsSetup = $state(false);
	let modelsMsg = $state(''); // inline feedback when the model choice is persisted

	// channels (AI provider settings — base_url/key/model, replaces .env)
	let channels = $state<Channel[]>([]);
	let activeChannelId = $state<string | null>(null);

	// workflows (v3)
	type WorkflowItem = { slug: string; name: string; questionPattern: string; mode?: SearchMode };
	let workflows = $state<WorkflowItem[]>([]);
	let savingWorkflow = $state(false);
	let savedMsg = $state('');
	let replayHint = $state('');

	onMount(() => {
		mode = document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light';
		loadModels();
		loadChannels();
		loadWorkflows();
		loadSaveDir();
		loadRegion();
		// First-run: open the welcome wizard until the user has been through it once.
		try {
			if (!localStorage.getItem('us-onboarded')) onboardingOpen = true;
		} catch {
			/* private mode etc. */
		}
	});

	async function loadSaveDir() {
		try {
			const r = await fetch('/api/settings');
			if (!r.ok) return;
			const d = await r.json();
			saveDir = d.saveDir ?? '';
			saveDirInput = saveDir;
		} catch {
			/* not fatal */
		}
	}

	async function saveSaveDir() {
		if (savingDir) return;
		savingDir = true;
		saveDirMsg = '';
		saveDirOk = null;
		try {
			const r = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ saveDir: saveDirInput })
			});
			const d = await r.json().catch(() => ({}));
			saveDirOk = !!d.ok;
			if (d.ok) {
				saveDir = d.saveDir ?? saveDirInput;
				saveDirInput = saveDir;
				saveDirMsg = '已保存';
			} else {
				saveDirMsg = d.error ?? '保存失败';
			}
		} catch {
			saveDirOk = false;
			saveDirMsg = '无法连接本地服务';
		} finally {
			savingDir = false;
		}
	}

	async function loadWorkflows() {
		try {
			const r = await fetch('/api/workflows');
			if (!r.ok) return;
			const data = await r.json();
			workflows = data.workflows ?? [];
		} catch {
			/* not fatal */
		}
	}

	async function loadModels() {
		try {
			const r = await fetch('/api/models');
			if (!r.ok) return;
			models = await r.json();
			needsSetup = models?.needsSetup ?? false;
			fanoutModel = models!.defaults.fanout;
			synthModel = models!.defaults.synth;
		} catch {
			/* selectors stay empty; not fatal */
		}
	}

	async function loadChannels() {
		try {
			const r = await fetch('/api/channels');
			if (!r.ok) return;
			const d = await r.json();
			channels = d.channels ?? [];
			activeChannelId = d.activeId ?? null;
		} catch {
			/* not fatal */
		}
	}

	const activeChannelName = $derived(channels.find((c) => c.id === activeChannelId)?.name ?? '');

	// Persist the fanout/synth model choice onto the active channel so it survives a
	// refresh (the channel is the source of truth /api/models reads back as defaults).
	// Auto-saved on change — no separate button, so "选了就记住". We set the changed
	// value explicitly (not relying on bind:value's timing vs this handler) so the PUT
	// never sends a stale selection.
	async function saveModelChoice(which: 'fanout' | 'synth', value: string) {
		if (which === 'fanout') fanoutModel = value;
		else synthModel = value;
		if (!activeChannelId) return; // env fallback without a channel — nothing to persist to
		modelsMsg = '';
		try {
			const r = await fetch(`/api/channels/${activeChannelId}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ fanoutModel, synthModel })
			});
			modelsMsg = r.ok ? '已记住模型选择' : `保存失败：HTTP ${r.status}`;
			if (r.ok) loadChannels(); // keep client channel state in sync (silent)
		} catch {
			modelsMsg = '保存失败：无法连接本地服务';
		}
	}

	// Quick-switch the active channel from the composer popup (no need to open the
	// full modal). Reloads models so the fanout/synth pickers reflect the new channel.
	async function activateChannel(id: string) {
		if (!id || id === activeChannelId) return;
		activeChannelId = id;
		modelsMsg = '';
		try {
			await fetch('/api/channels/active', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id })
			});
			loadModels();
			loadChannels();
		} catch {
			/* ignore — a reload reflects server truth */
		}
	}

	// Information-source region — read once on mount, persisted on change (like the model
	// picker: "选了就记住"), so it survives refreshes. Server default is 'mixed'.
	async function loadRegion() {
		try {
			const r = await fetch('/api/settings/region');
			if (!r.ok) return;
			const d = await r.json();
			sourceRegion = d.region === 'domestic' || d.region === 'foreign' ? d.region : 'mixed';
		} catch {
			/* not fatal */
		}
	}

	async function saveRegion(value: string) {
		sourceRegion = value === 'domestic' || value === 'foreign' ? value : 'mixed';
		regionMsg = '';
		try {
			const r = await fetch('/api/settings/region', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ region: sourceRegion })
			});
			regionMsg = r.ok ? '已记住信息源区域' : `保存失败：HTTP ${r.status}`;
		} catch {
			regionMsg = '保存失败：无法连接本地服务';
		}
	}

	function onChannelsChanged() {
		loadModels();
		loadChannels();
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
		repos = [];
		depositFiles = [];
		reportPath = '';
		errorMsg = '';
		depositing = false;
		savingWorkflow = false;
		savedMsg = '';
		quickResults = null;
		quickLoading = false;
	}

	function switchMode(m: SearchMode) {
		if (searchMode === m) return;
		searchMode = m;
		resetRun(); // a run belongs to one mode — don't carry state across the toggle
	}

	async function saveAsWorkflow() {
		if (!runId || savingWorkflow) return;
		savingWorkflow = true;
		savedMsg = '';
		try {
			const r = await fetch('/api/workflows', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ runId })
			});
			const data = await r.json().catch(() => ({}));
			if (r.ok && !data.error) {
				savedMsg = `已另存为工作流：${data.name}`;
				loadWorkflows();
			} else {
				savedMsg = data.error ? `保存失败：${data.error}` : `保存失败：HTTP ${r.status}`;
			}
		} catch {
			savedMsg = '保存失败：无法连接本地服务';
		} finally {
			savingWorkflow = false;
		}
	}

	async function removeWorkflow(slug: string, name: string) {
		if (!confirm(`删除工作流「${name}」？此操作不可撤销。`)) return;
		replayHint = '';
		try {
			const r = await fetch(`/api/workflows?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' });
			if (r.ok) {
				workflows = workflows.filter((w) => w.slug !== slug);
			} else {
				replayHint = `删除失败：HTTP ${r.status}`;
			}
		} catch {
			replayHint = '删除失败：无法连接本地服务';
		}
	}

	// Load a saved workflow into the editor: fill the question box with its saved last
	// question, pre-populate the plan (dimensions/sources as last selected), and park at
	// awaiting_edit so the user reviews and clicks 开始搜索. Does NOT auto-search.
	async function openWorkflow(slug: string) {
		replayHint = '';
		resetRun();
		settingsOpen = false;
		let r: Response;
		try {
			r = await fetch('/api/workflows/replay', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ workflow: slug, fanoutModel, synthModel })
			});
		} catch {
			phase = 'error';
			errorMsg = '无法连接本地服务';
			return;
		}
		if (!r.ok) {
			phase = 'error';
			errorMsg = `载入失败：HTTP ${r.status}`;
			return;
		}
		const data = await r.json();
		runId = data.id;
		plan = data.plan;
		question = data.question ?? question; // 填入工作流保存的上次搜索内容
		searchMode = data.mode ?? 'report';
		phase = 'awaiting_edit'; // 落到可编辑计划，等用户确认后点「开始搜索」
		// Open the SSE stream now (like start() does) so 开始搜索 → runIt receives progress.
		listen(data.id);
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
				reportPath = e.reportPath ?? ''; if (e.repos) repos = e.repos;
				es?.close();
			} else if (e.phase === 'error') {
				errorMsg = e.message;
				es?.close();
			}
		};
	}

	async function quickSearch() {
		if (!question.trim() || quickLoading) return;
		resetRun();
		quickLoading = true;
		try {
			const r = await fetch('/api/quick-search', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ query: question })
			});
			if (!r.ok) {
				phase = 'error';
				errorMsg = `搜索失败：HTTP ${r.status}`;
				return;
			}
			const data = await r.json();
			quickResults = data.results ?? [];
			phase = 'done';
		} catch {
			phase = 'error';
			errorMsg = '无法连接本地服务';
		} finally {
			quickLoading = false;
		}
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
				body: JSON.stringify({ question, mode: searchMode, fanoutModel, synthModel })
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
		searchMode = data.mode ?? searchMode;
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
	// Community targets share one keyword query — editing it updates every target in the dim.
	function setCommunityKeywords(di: number, value: string) {
		for (const s of plan!.dimensions[di].sources) s.query = value;
	}
	const TARGET_KIND_LABEL: Record<string, string> = {
		subreddit: '社区',
		hn: 'HN',
		domain: '网站',
		web: '开放网络',
		writing: '他人写作'
	};
	const targetKindLabel = (kind?: string) => TARGET_KIND_LABEL[kind ?? ''] ?? '网站';
	// Broad, low-trust escape-hatch sources (open web / Exa) — shown below the vetted picks.
	const isBroad = (kind?: string) => kind === 'web' || kind === 'writing';
</script>

<div class="wrap">
	<div class="app">
		<div class="topbar">
			<div class="brand">
				<span class="mark"><i class="ph ph-magnifying-glass"></i></span> 万能搜索
				<span class="sub">/ 搜索并保存知识</span>
			</div>
			<div class="tools">
				<button class="iconbtn" onclick={() => (onboardingOpen = true)} title="新手引导" aria-label="新手引导">
					<i class="ph ph-question"></i>
				</button>
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
							<h3><i class="ph ph-gear-six"></i> 设置</h3>
							<p class="note">{activeChannelName ? `当前渠道：${activeChannelName}` : '尚未配置 AI 渠道'}</p>
							{#if providerHost}
								<div class="provider">提供商主机 <b>{providerHost}</b></div>
							{/if}
							{#if channels.length > 1}
								<div class="grp">
									<label class="fld" for="ch-active">当前渠道（快捷切换）</label>
									<div class="selrow">
										<select id="ch-active" value={activeChannelId} onchange={(e) => activateChannel(e.currentTarget.value)}>
											{#each channels as c}<option value={c.id}>{c.name}</option>{/each}
										</select>
										<i class="ph ph-caret-down caret"></i>
									</div>
								</div>
							{/if}
							<button
								class="btn btn-ghost"
								style="width:100%;justify-content:center;margin-bottom:13px"
								onclick={() => {
									settingsOpen = false;
									channelsOpen = true;
								}}
							>
								<i class="ph ph-plugs-connected"></i> 管理渠道…
							</button>
							{#if models?.models?.length}
								<div class="grp">
									<label class="fld" for="fanout">铺广度模型（便宜 · 提查询/压缩/打标签）</label>
									<div class="selrow">
										<select id="fanout" bind:value={fanoutModel} onchange={(e) => saveModelChoice('fanout', e.currentTarget.value)}>
											{#each models?.models ?? [] as m}<option value={m}>{m}</option>{/each}
										</select>
										<i class="ph ph-caret-down caret"></i>
									</div>
								</div>
								<div class="grp">
									<label class="fld" for="synth">收口模型（强 · 综合报告）</label>
									<div class="selrow">
										<select id="synth" bind:value={synthModel} onchange={(e) => saveModelChoice('synth', e.currentTarget.value)}>
											{#each models?.models ?? [] as m}<option value={m}>{m}</option>{/each}
										</select>
										<i class="ph ph-caret-down caret"></i>
									</div>
								</div>
								<p class="note" style="margin:-4px 0 13px">{modelsMsg || '选择即自动记住（保存到当前渠道）'}</p>
							{/if}
							<div class="grp">
								<label class="fld" for="src-region">信息源来源</label>
								<div class="selrow">
									<select id="src-region" value={sourceRegion} onchange={(e) => saveRegion(e.currentTarget.value)}>
										<option value="mixed">混合（国内 + 国外）</option>
										<option value="domestic">国内</option>
										<option value="foreign">国外</option>
									</select>
									<i class="ph ph-caret-down caret"></i>
								</div>
								<p class="note" style="margin:6px 0 13px">{regionMsg || '限定信息源区域：影响生成维度与所选社区/网站'}</p>
							</div>
							<div class="grp">
								<label class="fld" for="savedir">保存目录（报告写入此处）</label>
								<input id="savedir" type="text" bind:value={saveDirInput} placeholder="/Users/you/research" />
							</div>
							<div class="row" style="justify-content:space-between;margin-bottom:13px">
								{#if saveDirMsg}
									<span class="test-msg" class:ok={saveDirOk} class:fail={saveDirOk === false}>{saveDirMsg}</span>
								{:else}
									<span class="dim" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{saveDir || '尚未设置'}</span>
								{/if}
								<button class="btn btn-ghost" onclick={saveSaveDir} disabled={savingDir}>
									{#if savingDir}<span class="spin"></span> 保存中…{:else}保存目录{/if}
								</button>
							</div>
							<button class="btn btn-soft" style="width:100%;justify-content:center" onclick={() => (settingsOpen = false)}>完成</button>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="body">
			<div class="seg mode-seg">
				<button class:on={searchMode === 'report'} onclick={() => switchMode('report')}><i class="ph ph-article"></i> 报告搜索</button>
				<button class:on={searchMode === 'github'} onclick={() => switchMode('github')}><i class="ph ph-github-logo"></i> GitHub 工具</button>
				<button class:on={searchMode === 'quick'} onclick={() => switchMode('quick')}><i class="ph ph-lightning"></i> 快速搜索</button>
			</div>
			<label class="fld" for="q">{searchMode === 'github' ? '想找什么工具？' : searchMode === 'quick' ? '搜索任何内容' : '想了解点什么？'}</label>
			<textarea id="q" rows="2" bind:value={question} placeholder={searchMode === 'github' ? '描述你的需求，如：一个快速的本地向量数据库…' : searchMode === 'quick' ? '输入关键词，直达网页结果…' : '提出你的问题…'}></textarea>
			<div class="toolbar-between" style="margin-top:12px">
				<span class="dim">{searchMode === 'github' ? '始终搜索 GitHub' : searchMode === 'quick' ? '直接搜索网页，无需设置' : '维度可编辑'}</span>
				{#if searchMode === 'quick'}
					<button class="btn btn-primary" onclick={quickSearch} disabled={!question.trim() || quickLoading}>
						{#if quickLoading}<span class="spin"></span> 搜索中…{:else}搜索 <i class="ph ph-magnifying-glass"></i>{/if}
					</button>
				{:else}
					<button class="btn btn-primary" onclick={start} disabled={!question.trim() || phase === 'proposing'}>
						{#if phase === 'proposing'}<span class="spin"></span> 生成中…{:else}{searchMode === 'github' ? '生成 GitHub 查询' : '生成搜索计划'} <i class="ph ph-arrow-right"></i>{/if}
					</button>
				{/if}
			</div>

			{#if needsSetup && searchMode !== 'quick'}
				<button class="setup-hint" onclick={() => (channelsOpen = true)}>
					<i class="ph ph-warning-circle"></i>
					<span>尚未配置 AI 渠道 — 报告/GitHub 模式需要一个 AI 模型。点此添加渠道。</span>
				</button>
			{/if}

			<!-- 已存工作流：点击载入上次问题 + 维度到可编辑计划，确认后再搜索 -->
			{#if phase === 'idle' && workflows.length}
				<div class="plan-head">
					<h2>已存工作流</h2>
					<span class="dim" class:hint={replayHint}>{replayHint || '点击载入上次问题与维度到计划，确认后再搜索'}</span>
				</div>
				<div style="display:flex;flex-direction:column;gap:8px">
					{#each workflows as wf (wf.slug)}
						<div class="wf-row">
							<button
								class="btn btn-ghost wf-replay"
								onclick={() => openWorkflow(wf.slug)}
								title="载入此工作流：填入上次问题与维度，确认后搜索"
							>
								<i class="ph {wf.mode === 'github' ? 'ph-github-logo' : 'ph-lightning'}"></i>
								<span style="font-weight:600">{wf.name}</span>
								<span class="dim wf-pattern">{wf.questionPattern}</span>
							</button>
							<button class="del" onclick={() => removeWorkflow(wf.slug, wf.name)} title="删除此工作流" aria-label="删除此工作流"><i class="ph ph-trash"></i></button>
						</div>
					{/each}
				</div>
			{/if}

			{#if searchMode === 'report'}
			<!-- 搜索计划（可编辑） -->
			{#if plan && phase === 'awaiting_edit'}
				<div class="plan-head">
					<h2>搜索计划</h2>
					<span class="dim">勾选启用 · 直接改写查询 · 可增删</span>
				</div>
				{#each plan.dimensions as dim, di (dim.key)}
					{#if dim.key === 'community'}
						<!-- 搜索来源：统一护栏选择器（精选默认选中前 3；开放网络等宽泛来源默认关闭） -->
						<div class="dim-group" style={dim.enabled ? '' : 'opacity:.55'}>
							<div class="dim-head">
								<button class="tgl" class:off={!dim.enabled} onclick={() => (dim.enabled = !dim.enabled)} aria-label="启用或停用此维度"></button>
								<span class="dim-name">{dim.label}</span>
								<span class="dim">AI 只读你勾选的来源 · 精选默认选中前 3</span>
							</div>
							<div class="comm-kw">
								<i class="ph ph-magnifying-glass"></i>
								<input
									type="text"
									value={dim.sources[0]?.query ?? ''}
									placeholder="搜索关键词（应用于下列所有来源）"
									oninput={(e) => setCommunityKeywords(di, e.currentTarget.value)}
									aria-label="搜索来源关键词"
								/>
							</div>
							{#each dim.sources as s, i (s.id)}
								{#if isBroad(s.target?.kind) && !isBroad(dim.sources[i - 1]?.target?.kind)}
										<div class="comm-divider"><i class="ph ph-warning"></i> 宽泛来源（低信任，谨慎开启）</div>
									{/if}
									<div class="src comm-target" class:low-trust={isBroad(s.target?.kind)} style={s.enabled ? '' : 'opacity:.55'}>
									<button class="tgl" class:off={!s.enabled} onclick={() => (s.enabled = !s.enabled)} aria-label="选中或取消此来源"></button>
									<span class="comm-name">{s.label ?? s.target?.value ?? s.query}</span>
									<span class="badge-kind kind-{s.target?.kind ?? 'domain'}">{targetKindLabel(s.target?.kind)}</span>
									{#if s.scoreLabel}<span class="badge-score">{s.scoreLabel}</span>{/if}
									<button class="del" onclick={() => removeSource(di, i)} aria-label="删除"><i class="ph ph-x"></i></button>
								</div>
							{/each}
						</div>
					{:else}
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
					{/if}
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
						<div class="t">保存到目录</div>
						<div class="m">需你确认后写入</div>
					</li>
				</ul>
			{/if}

			<ReportResult
				{phase}
				{markdown}
				{renderedReport}
				bind:reportView
				{rawCount}
				{willWritePath}
				{saveDir}
				{reportPath}
				{depositing}
				{savingWorkflow}
				{savedMsg}
				onDeposit={deposit}
				onSave={saveAsWorkflow}
			/>
			{:else if searchMode === 'github'}
			<GithubMode
				{phase}
				bind:plan
				{sourceChips}
				{repos}
				{savingWorkflow}
				{savedMsg}
				onRun={runIt}
				onSave={saveAsWorkflow}
			/>
			{:else}
			<QuickSearchMode loading={quickLoading} results={quickResults} />
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

{#if channelsOpen}
	<ChannelSettings onClose={() => (channelsOpen = false)} onChanged={onChannelsChanged} />
{/if}

{#if onboardingOpen}
	<OnboardingWizard
		onClose={() => (onboardingOpen = false)}
		onChannelsChanged={onChannelsChanged}
		onSaveDirChanged={(d) => {
			saveDir = d;
			saveDirInput = d;
		}}
	/>
{/if}
