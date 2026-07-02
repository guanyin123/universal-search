<script lang="ts">
	// First-run welcome wizard. Walks a brand-new user through the three things the
	// public build needs: ① pick an AI model (channel), ② pick a save directory,
	// ③ understand the three search modes. Dismissing (X / 跳过) sets us-onboarded so
	// it never auto-opens again — re-openable from the topbar help button.
	let {
		onClose,
		onChannelsChanged,
		onSaveDirChanged
	}: {
		onClose: () => void;
		onChannelsChanged: () => void;
		onSaveDirChanged: (dir: string) => void;
	} = $props();

	const STEPS = ['欢迎', '配置模型', '保存目录', '三种模式'];
	let step = $state(0); // 0 welcome · 1 model · 2 save dir · 3 modes

	// step 1 — channel form (slim mirror of ChannelSettings, posting to the same API)
	let form = $state({ name: '', baseURL: '', apiKey: '', models: '' });
	let testing = $state(false);
	let testMsg = $state('');
	let testOk = $state<boolean | null>(null);
	let savingCh = $state(false);
	let chErr = $state('');

	// step 2 — save dir
	let saveDir = $state('');
	let savingDir = $state(false);
	let dirMsg = $state('');
	let dirOk = $state<boolean | null>(null);

	function finish() {
		try {
			localStorage.setItem('us-onboarded', '1');
		} catch {
			/* private mode etc. */
		}
		onClose();
	}

	async function testChannel() {
		if (!form.baseURL.trim()) {
			testOk = false;
			testMsg = '请先填写 base_url';
			return;
		}
		testing = true;
		testMsg = '';
		testOk = null;
		try {
			const r = await fetch('/api/channels/test', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ baseURL: form.baseURL, apiKey: form.apiKey })
			});
			const d = await r.json().catch(() => ({}));
			if (!r.ok) {
				testOk = false;
				testMsg = d.message || `HTTP ${r.status}`;
				return;
			}
			testOk = d.ok;
			if (d.ok) {
				testMsg = `连接成功 · ${d.models.length} 个模型`;
				if (d.models.length) form.models = d.models.join(', '); // autofill the list
			} else {
				testMsg = `连接失败：${d.error ?? ''}`;
			}
		} catch {
			testOk = false;
			testMsg = '无法连接本地服务';
		} finally {
			testing = false;
		}
	}

	async function saveChannelNext() {
		if (!form.name.trim() || !form.baseURL.trim()) {
			chErr = '名称与 base_url 必填';
			return;
		}
		if (!form.apiKey.trim()) {
			chErr = '请填写密钥';
			return;
		}
		savingCh = true;
		chErr = '';
		try {
			const r = await fetch('/api/channels', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: form.name,
					baseURL: form.baseURL,
					apiKey: form.apiKey,
					models: form.models
				})
			});
			if (!r.ok) {
				const d = await r.json().catch(() => ({}));
				chErr = d.message || `保存失败：HTTP ${r.status}`;
				return;
			}
			onChannelsChanged();
			step = 2;
		} catch {
			chErr = '无法连接本地服务';
		} finally {
			savingCh = false;
		}
	}

	async function saveDirNext() {
		if (!saveDir.trim()) {
			dirOk = false;
			dirMsg = '请填写保存目录';
			return;
		}
		savingDir = true;
		dirMsg = '';
		dirOk = null;
		try {
			const r = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ saveDir })
			});
			const d = await r.json().catch(() => ({}));
			dirOk = !!d.ok;
			if (d.ok) {
				onSaveDirChanged(d.saveDir ?? saveDir);
				step = 3;
			} else {
				dirMsg = d.error ?? '保存失败';
			}
		} catch {
			dirOk = false;
			dirMsg = '无法连接本地服务';
		} finally {
			savingDir = false;
		}
	}
</script>

<div class="modal-overlay">
	<button class="modal-scrim" aria-label="关闭" onclick={finish}></button>
	<div class="modal wiz" role="dialog" aria-modal="true" aria-label="新手引导">
		<div class="modal-head">
			<h3><i class="ph ph-sparkle"></i> 欢迎使用万能搜索</h3>
			<button class="iconbtn" onclick={finish} aria-label="跳过引导"><i class="ph ph-x"></i></button>
		</div>

		<!-- stepper -->
		<div class="wiz-steps">
			{#each STEPS as label, i (label)}
				<div class="wiz-step" class:on={i === step} class:done={i < step}>
					<span class="wiz-dot">{#if i < step}<i class="ph ph-check"></i>{:else}{i + 1}{/if}</span>
					<span class="wiz-label">{label}</span>
				</div>
				{#if i < STEPS.length - 1}<span class="wiz-line" class:done={i < step}></span>{/if}
			{/each}
		</div>

		<!-- step 0 · welcome -->
		{#if step === 0}
			<div class="wiz-body">
				<p class="wiz-lead">这是一个把搜索沉淀成知识的工具。三步即可上手：</p>
				<ul class="wiz-checklist">
					<li><i class="ph ph-robot"></i> 配置一个 AI 模型（你自己的渠道与密钥）</li>
					<li><i class="ph ph-folder-open"></i> 选择报告保存到本地的哪个目录</li>
					<li><i class="ph ph-compass"></i> 认识报告 / GitHub / 快速三种搜索模式</li>
				</ul>
			</div>
		{/if}

		<!-- step 1 · configure model -->
		{#if step === 1}
			<div class="wiz-body">
				<p class="wiz-lead">本工具不内置模型，请填入你自己的 OpenAI 兼容渠道（OpenAI / DeepSeek / 本地 Ollama / 中转站均可）。</p>
				<div class="grp">
					<label class="fld" for="wiz-name">名称</label>
					<input id="wiz-name" type="text" bind:value={form.name} placeholder="如：OpenAI / DeepSeek" />
				</div>
				<div class="grp">
					<label class="fld" for="wiz-url">base_url</label>
					<input id="wiz-url" type="text" bind:value={form.baseURL} placeholder="https://api.openai.com/v1" />
				</div>
				<div class="grp">
					<label class="fld" for="wiz-key">密钥</label>
					<input id="wiz-key" type="password" bind:value={form.apiKey} placeholder="sk-..." autocomplete="off" />
				</div>
				<div class="grp">
					<button class="btn btn-soft" onclick={testChannel} disabled={testing}>
						{#if testing}<span class="spin"></span> 测试中…{:else}<i class="ph ph-plugs"></i> 测试连接{/if}
					</button>
					{#if testMsg}<span class="test-msg" class:ok={testOk} class:fail={testOk === false}>{testMsg}</span>{/if}
				</div>
				<div class="grp">
					<label class="fld" for="wiz-models">可用模型（逗号分隔 ·「测试连接」可自动填充）</label>
					<input id="wiz-models" type="text" bind:value={form.models} placeholder="gpt-4o, gpt-4o-mini" />
				</div>
				{#if chErr}<div class="note-line warn"><i class="ph ph-warning-circle"></i> {chErr}</div>{/if}
			</div>
		{/if}

		<!-- step 2 · save directory -->
		{#if step === 2}
			<div class="wiz-body">
				<p class="wiz-lead">报告与原始证据会以 Markdown 写入这个目录。请填写一个绝对路径（不存在会自动创建）。</p>
				<div class="grp">
					<label class="fld" for="wiz-dir">保存目录</label>
					<input id="wiz-dir" type="text" bind:value={saveDir} placeholder="/Users/you/research" />
				</div>
				{#if dirMsg}<div class="note-line" class:ok={dirOk} class:warn={dirOk === false}><i class="ph {dirOk ? 'ph-check-circle' : 'ph-warning-circle'}"></i> {dirMsg}</div>{/if}
				<p class="dim" style="margin-top:6px">报告写到 <code>&lt;目录&gt;/wiki/synthesis/</code>，原始来源写到 <code>&lt;目录&gt;/raw/research/</code>。</p>
			</div>
		{/if}

		<!-- step 3 · three modes -->
		{#if step === 3}
			<div class="wiz-body">
				<p class="wiz-lead">顶部可切换三种搜索模式，按需要选用：</p>
				<div class="wiz-modes">
					<div class="wiz-mode">
						<span class="wiz-mode-ico"><i class="ph ph-article"></i></span>
						<div>
							<div class="wiz-mode-name">报告搜索</div>
							<div class="dim">多维度并行搜索 → 强模型综合成结构化报告，可保存到你的目录。</div>
						</div>
					</div>
					<div class="wiz-mode">
						<span class="wiz-mode-ico"><i class="ph ph-github-logo"></i></span>
						<div>
							<div class="wiz-mode-name">GitHub 工具</div>
							<div class="dim">用自然语言描述需求，搜罗并排序 GitHub 仓库，快速找到合适的工具。</div>
						</div>
					</div>
					<div class="wiz-mode">
						<span class="wiz-mode-ico"><i class="ph ph-lightning"></i></span>
						<div>
							<div class="wiz-mode-name">快速搜索</div>
							<div class="dim">直接返回网页结果，无需 AI，最快。</div>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- footer -->
		<div class="wiz-foot">
			{#if step > 0}
				<button class="btn btn-ghost" onclick={() => (step -= 1)}><i class="ph ph-arrow-left"></i> 上一步</button>
			{:else}
				<button class="btn btn-ghost" onclick={finish}>跳过引导</button>
			{/if}
			<div class="wiz-foot-right">
				{#if step === 1 || step === 2}
					<button class="btn btn-ghost" onclick={() => (step += 1)}>跳过此步</button>
				{/if}
				{#if step === 0}
					<button class="btn btn-primary" onclick={() => (step = 1)}>开始设置 <i class="ph ph-arrow-right"></i></button>
				{:else if step === 1}
					<button class="btn btn-primary" onclick={saveChannelNext} disabled={savingCh}>
						{#if savingCh}<span class="spin"></span> 保存中…{:else}保存并继续 <i class="ph ph-arrow-right"></i>{/if}
					</button>
				{:else if step === 2}
					<button class="btn btn-primary" onclick={saveDirNext} disabled={savingDir}>
						{#if savingDir}<span class="spin"></span> 保存中…{:else}保存并继续 <i class="ph ph-arrow-right"></i>{/if}
					</button>
				{:else}
					<button class="btn btn-primary" onclick={finish}><i class="ph ph-check"></i> 开始使用</button>
				{/if}
			</div>
		</div>
	</div>
</div>
