<script lang="ts">
	import { onMount } from 'svelte';

	type ChannelPublic = {
		id: string;
		name: string;
		baseURL: string;
		models: string[];
		fanoutModel?: string;
		synthModel?: string;
		hasKey: boolean;
		keyHint: string;
		createdAt: string;
	};

	// onClose: dismiss the modal. onChanged: a channel was created/updated/removed/activated
	// — parent re-fetches /api/models so the composer's pickers stay in sync.
	let { onClose, onChanged }: { onClose: () => void; onChanged: () => void } = $props();

	let channels = $state<ChannelPublic[]>([]);
	let activeId = $state<string | null>(null);
	let loading = $state(true);

	// editing: null = no form; {} = creating; { id } = editing an existing channel
	let editing = $state<null | { id?: string }>(null);
	let form = $state({ name: '', baseURL: '', apiKey: '', models: '', fanoutModel: '', synthModel: '' });
	let keyPlaceholder = $state('sk-...');
	let testing = $state(false);
	let testMsg = $state('');
	let testOk = $state<boolean | null>(null);
	let saving = $state(false);
	let errMsg = $state('');

	onMount(load);

	async function load() {
		loading = true;
		try {
			const r = await fetch('/api/channels');
			if (r.ok) {
				const d = await r.json();
				channels = d.channels ?? [];
				activeId = d.activeId ?? null;
			}
		} catch {
			/* not fatal — empty list shows the "add channel" prompt */
		} finally {
			loading = false;
		}
	}

	function resetFormState() {
		testMsg = '';
		testOk = null;
		errMsg = '';
	}

	function startCreate() {
		editing = {};
		form = { name: '', baseURL: '', apiKey: '', models: '', fanoutModel: '', synthModel: '' };
		keyPlaceholder = 'sk-...';
		resetFormState();
	}

	function startEdit(c: ChannelPublic) {
		editing = { id: c.id };
		form = {
			name: c.name,
			baseURL: c.baseURL,
			apiKey: '',
			models: c.models.join(', '),
			fanoutModel: c.fanoutModel ?? '',
			synthModel: c.synthModel ?? ''
		};
		keyPlaceholder = c.hasKey ? `留空则保留现有密钥（${c.keyHint}）` : 'sk-...';
		resetFormState();
	}

	async function test() {
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
				body: JSON.stringify({ baseURL: form.baseURL, apiKey: form.apiKey, id: editing?.id })
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
				if (d.models.length) form.models = d.models.join(', '); // autofill the model list
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

	async function save() {
		if (!form.name.trim() || !form.baseURL.trim()) {
			errMsg = '名称与 base_url 必填';
			return;
		}
		if (!editing?.id && !form.apiKey.trim()) {
			errMsg = '新建渠道需填写密钥';
			return;
		}
		saving = true;
		errMsg = '';
		try {
			const payload = {
				name: form.name,
				baseURL: form.baseURL,
				apiKey: form.apiKey,
				models: form.models,
				fanoutModel: form.fanoutModel,
				synthModel: form.synthModel
			};
			const r = editing?.id
				? await fetch(`/api/channels/${editing.id}`, {
						method: 'PUT',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(payload)
					})
				: await fetch('/api/channels', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(payload)
					});
			if (!r.ok) {
				const d = await r.json().catch(() => ({}));
				errMsg = d.message || `保存失败：HTTP ${r.status}`;
				return;
			}
			editing = null;
			await load();
			onChanged();
		} catch {
			errMsg = '无法连接本地服务';
		} finally {
			saving = false;
		}
	}

	async function activate(id: string) {
		try {
			await fetch('/api/channels/active', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id })
			});
			await load();
			onChanged();
		} catch {
			/* ignore — list reload reflects truth */
		}
	}

	async function remove(c: ChannelPublic) {
		if (!confirm(`删除渠道「${c.name}」？此操作不可撤销。`)) return;
		try {
			await fetch(`/api/channels/${c.id}`, { method: 'DELETE' });
			if (editing?.id === c.id) editing = null;
			await load();
			onChanged();
		} catch {
			/* ignore */
		}
	}

	function host(u: string): string {
		try {
			return new URL(u).hostname.replace(/^www\./, '');
		} catch {
			return u;
		}
	}
</script>

<div class="modal-overlay">
	<button class="modal-scrim" aria-label="关闭" onclick={onClose}></button>
	<div class="modal" role="dialog" aria-modal="true" aria-label="管理 AI 渠道">
		<div class="modal-head">
			<h3><i class="ph ph-plugs-connected"></i> 管理 AI 渠道</h3>
			<button class="iconbtn" onclick={onClose} aria-label="关闭"><i class="ph ph-x"></i></button>
		</div>
		<p class="note">配置不同渠道的 base_url、密钥与模型；选中的渠道即当前使用。密钥加密存储于本地，绝不外传。</p>

		{#if loading}
			<div class="ch-empty"><span class="spin"></span> 加载中…</div>
		{:else}
			<div class="ch-list">
				{#each channels as c (c.id)}
					<div class="ch-row" class:active={c.id === activeId}>
						<button
							class="ch-pick"
							class:on={c.id === activeId}
							onclick={() => activate(c.id)}
							title={c.id === activeId ? '当前渠道' : '设为当前'}
							aria-label="设为当前渠道"
						></button>
						<div class="ch-meta">
							<div class="ch-name">{c.name}{#if c.id === activeId}<span class="pill">当前</span>{/if}</div>
							<div class="ch-sub">{host(c.baseURL)} · {c.models.length} 模型 · 密钥 {c.hasKey ? c.keyHint : '未设置'}</div>
						</div>
						<button class="iconbtn" onclick={() => startEdit(c)} aria-label="编辑"><i class="ph ph-pencil-simple"></i></button>
						<button class="iconbtn danger" onclick={() => remove(c)} aria-label="删除"><i class="ph ph-trash"></i></button>
					</div>
				{:else}
					<div class="ch-empty">还没有渠道。点击下方「新增渠道」添加一个。</div>
				{/each}
			</div>

			{#if !editing}
				<button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:10px" onclick={startCreate}>
					<i class="ph ph-plus"></i> 新增渠道
				</button>
			{/if}
		{/if}

		{#if editing}
			<div class="ch-form">
				<div class="ch-form-head">{editing.id ? '编辑渠道' : '新增渠道'}</div>
				<div class="grp">
					<label class="fld" for="ch-name">名称</label>
					<input id="ch-name" type="text" bind:value={form.name} placeholder="如：OpenAI / 本地 Ollama / 中转站" />
				</div>
				<div class="grp">
					<label class="fld" for="ch-url">base_url</label>
					<input id="ch-url" type="text" bind:value={form.baseURL} placeholder="https://api.openai.com/v1" />
				</div>
				<div class="grp">
					<label class="fld" for="ch-key">密钥</label>
					<input id="ch-key" type="password" bind:value={form.apiKey} placeholder={keyPlaceholder} autocomplete="off" />
				</div>
				<div class="grp">
					<button class="btn btn-soft" onclick={test} disabled={testing}>
						{#if testing}<span class="spin"></span> 测试中…{:else}<i class="ph ph-plugs"></i> 测试连接{/if}
					</button>
					{#if testMsg}
						<span class="test-msg" class:ok={testOk} class:fail={testOk === false}>{testMsg}</span>
					{/if}
				</div>
				<div class="grp">
					<label class="fld" for="ch-models">可用模型（逗号分隔 · 「测试连接」可自动填充）</label>
					<input id="ch-models" type="text" bind:value={form.models} placeholder="gpt-4o, gpt-4o-mini" />
				</div>
				<div class="ch-form-row">
					<div class="grp">
						<label class="fld" for="ch-fanout">铺广度模型（可选）</label>
						<input id="ch-fanout" type="text" bind:value={form.fanoutModel} placeholder="留空用列表首个" />
					</div>
					<div class="grp">
						<label class="fld" for="ch-synth">收口模型（可选）</label>
						<input id="ch-synth" type="text" bind:value={form.synthModel} placeholder="留空用列表首个" />
					</div>
				</div>
				{#if errMsg}<div class="note-line warn"><i class="ph ph-warning-circle"></i> {errMsg}</div>{/if}
				<div class="ch-form-actions">
					<button class="btn btn-ghost" onclick={() => (editing = null)}>取消</button>
					<button class="btn btn-primary" onclick={save} disabled={saving}>
						{#if saving}<span class="spin"></span> 保存中…{:else}保存{/if}
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>
