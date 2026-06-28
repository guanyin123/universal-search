<script lang="ts">
	type QuickResult = { url: string; title: string; snippet: string; publishedAt?: string };

	let { loading, results }: { loading: boolean; results: QuickResult[] | null } = $props();

	// Per-result expand state (keyed by url) — collapsed by default for a tidy list.
	let expanded = $state<Record<string, boolean>>({});

	// Only offer expand/collapse when the snippet is long enough to actually be clamped.
	const CLAMP_THRESHOLD = 160;

	function host(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}
</script>

{#if loading}
	<div class="quick-loading"><span class="spin"></span> 搜索中…</div>
{:else if results && results.length}
	<div class="plan-head" style="margin-top:22px">
		<h2>搜索结果</h2>
		<span class="dim">{results.length} 条 · 点击直达</span>
	</div>
	<div class="quick-list">
		{#each results as r (r.url)}
			<div class="quick-card">
				<a class="quick-title" href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
				<div class="quick-url">
					{host(r.url)}{#if r.publishedAt} · {r.publishedAt.slice(0, 10)}{/if}
				</div>
				{#if r.snippet}
					<div class="quick-snippet" class:clamped={!expanded[r.url]}>{r.snippet}</div>
					{#if r.snippet.length > CLAMP_THRESHOLD}
						<button class="quick-toggle" onclick={() => (expanded[r.url] = !expanded[r.url])}>
							{expanded[r.url] ? '收起' : '展开'}
							<i class="ph {expanded[r.url] ? 'ph-caret-up' : 'ph-caret-down'}"></i>
						</button>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
{:else if results}
	<div class="quick-loading">未找到相关结果。</div>
{/if}
