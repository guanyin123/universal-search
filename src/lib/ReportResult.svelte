<script lang="ts">
	let {
		phase,
		markdown,
		renderedReport,
		reportView = $bindable(),
		rawCount,
		willWritePath,
		saveDir,
		reportPath,
		depositing,
		savingWorkflow,
		savedMsg,
		onDeposit,
		onSave
	}: {
		phase: string;
		markdown: string;
		renderedReport: string;
		reportView: 'preview' | 'source';
		rawCount: number;
		willWritePath: string;
		saveDir: string;
		reportPath: string;
		depositing: boolean;
		savingWorkflow: boolean;
		savedMsg: string;
		onDeposit: () => void;
		onSave: () => void;
	} = $props();
</script>

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
			<span style="margin-left:auto">将保存到目录</span>
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
				<div class="where">将写入 <code>{saveDir ? `${saveDir}/${willWritePath}` : willWritePath}</code></div>
				{#if !saveDir}
					<div class="note-line warn" style="margin-top:4px">
						<i class="ph ph-warning-circle"></i> 尚未配置保存目录 — 请先在「设置」中指定一个目录
					</div>
				{/if}
			</div>
			<button class="btn btn-primary" onclick={onDeposit} disabled={depositing || !saveDir}>
				{#if depositing}<span class="spin"></span> 保存中…{:else}<i class="ph ph-tray-arrow-down"></i> 确认保存到目录{/if}
			</button>
		</div>
	{/if}

	<!-- 另存为工作流：成功 run 后可凝固成可复用工作流 -->
	<div class="row" style="justify-content:space-between;margin-top:12px">
		<span class="dim">{savedMsg}</span>
		<button class="btn btn-ghost" onclick={onSave} disabled={savingWorkflow}>
			{#if savingWorkflow}<span class="spin"></span> 保存中…{:else}<i class="ph ph-floppy-disk"></i> 另存为工作流{/if}
		</button>
	</div>
{/if}

<!-- 完成 -->
{#if phase === 'done'}
	<div class="done-banner">
		<i class="ph ph-check-circle"></i> 已保存：<code>{reportPath}</code>
	</div>
{/if}
