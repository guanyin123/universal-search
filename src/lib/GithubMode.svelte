<script lang="ts">
	type Source = { id: string; api: string; query: string; enabled: boolean };
	type Plan = { dimensions: { key: string; label: string; enabled: boolean; sources: Source[] }[] };
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

	let {
		phase,
		plan = $bindable(),
		sourceChips,
		repos,
		savingWorkflow,
		savedMsg,
		onRun,
		onSave
	}: {
		phase: string;
		plan: Plan | null;
		sourceChips: { title: string; status: string }[];
		repos: Repo[];
		savingWorkflow: boolean;
		savedMsg: string;
		onRun: () => void;
		onSave: () => void;
	} = $props();

	const working = $derived(phase === 'searching' || phase === 'synthesizing');
	const sources = $derived(plan?.dimensions?.[0]?.sources ?? []);

	function addQuery() {
		const d = plan?.dimensions?.[0];
		if (!d) return;
		d.sources.push({ id: `github-${d.sources.length + 1}`, api: 'github', query: '', enabled: true });
	}
	function removeQuery(i: number) {
		plan?.dimensions?.[0]?.sources.splice(i, 1);
	}
	function fmtStars(n: number): string {
		return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`;
	}
</script>

<!-- GitHub 搜索计划（可编辑，无维度分组） -->
{#if plan && phase === 'awaiting_edit'}
	<div class="plan-head">
		<h2>GitHub 搜索查询</h2>
		<span class="dim">直接改写查询 · 可增删 · 始终搜索 GitHub</span>
	</div>
	{#each sources as s, i (s.id)}
		<div class="src">
			<i class="ph ph-github-logo grip"></i>
			<input type="text" bind:value={s.query} placeholder="如 vector database language:rust stars:>500" />
			<span class="badge-api">github</span>
			<button class="del" onclick={() => removeQuery(i)} aria-label="删除"><i class="ph ph-x"></i></button>
		</div>
	{/each}
	<button class="btn btn-ghost" onclick={addQuery}><i class="ph ph-plus"></i> 添加查询</button>
	<div class="toolbar-between">
		<span class="dim"></span>
		<button class="btn btn-primary" onclick={onRun}>搜索 GitHub <i class="ph ph-arrow-right"></i></button>
	</div>
{/if}

<!-- 执行中：时间线 -->
{#if working}
	<ul class="tl" style="margin-top:22px">
		<li>
			<span class="dot done"><i class="ph ph-check"></i></span>
			<div class="t">提出 GitHub 查询</div>
			<div class="m">已生成查询，你已编辑确认</div>
		</li>
		<li>
			<span class="dot {phase === 'searching' ? 'run' : 'done'}">{#if phase !== 'searching'}<i class="ph ph-check"></i>{/if}</span>
			<div class="t">搜索 GitHub 仓库</div>
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
			<span class="dot {phase === 'synthesizing' ? 'run' : 'wait'}">{#if phase !== 'synthesizing'}2{/if}</span>
			<div class="t">按 stars + 网上评价排序</div>
			<div class="m">{phase === 'synthesizing' ? '强模型评判口碑中…' : '等待候选就绪'}</div>
		</li>
	</ul>
{/if}

<!-- 结果：Top-5 仓库卡片 -->
{#if phase === 'done' && repos.length}
	<div class="plan-head" style="margin-top:22px">
		<h2>推荐工具</h2>
		<span class="dim">最多 5 个 · 按 stars + 网上评价打分</span>
	</div>
	<div class="repo-list">
		{#each repos as r (r.url)}
			<div class="repo-card">
				<div class="repo-head">
					<a href={r.url} target="_blank" rel="noopener noreferrer">{r.fullName}</a>
					<span class="repo-stars" title="收藏数"><i class="ph ph-star"></i> {fmtStars(r.stars)}</span>
					<span class="repo-score" title="综合评分（stars + 网上评价）">{r.score.toFixed(1)}</span>
				</div>
				{#if r.description}<div class="repo-desc">{r.description}</div>{/if}
				{#if r.reason}<div class="repo-reason"><i class="ph ph-sparkle"></i> {r.reason}</div>{/if}
				<div class="repo-meta">
					{#if r.language}<span class="pill">{r.language}</span>{/if}
					{#if r.license}<span class="pill">{r.license}</span>{/if}
					{#each (r.topics ?? []).slice(0, 4) as t}<span class="pill tag">{t}</span>{/each}
					{#if r.pushedAt}<span class="dim" style="margin-left:auto">更新于 {r.pushedAt.slice(0, 10)}</span>{/if}
				</div>
			</div>
		{/each}
	</div>

	<!-- 另存为工作流：把这次 GitHub 搜索凝固成可复用工作流 -->
	<div class="row" style="justify-content:space-between;margin-top:12px">
		<span class="dim">{savedMsg}</span>
		<button class="btn btn-ghost" onclick={onSave} disabled={savingWorkflow}>
			{#if savingWorkflow}<span class="spin"></span> 保存中…{:else}<i class="ph ph-floppy-disk"></i> 另存为工作流{/if}
		</button>
	</div>
{/if}
