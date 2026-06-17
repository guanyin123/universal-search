# Universal Search v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 "lean spine" of Universal Search — a local SvelteKit web app where you ask a question, edit an AI-proposed web-search plan, watch it run, and deposit a synthesized report into a local Obsidian vault.

**Architecture:** A single localhost SvelteKit (`adapter-node`) app. The Node server owns all I/O: provider-agnostic LLM calls (Vercel AI SDK + OpenAI-compatible), Tavily web search, Jina Reader extraction, and safe git-tracked writes into the vault. A hand-rolled run state machine (`proposing → awaiting_edit → searching → synthesizing → awaiting_deposit → depositing → done`) persists each run as an atomic JSON file and streams progress to the browser over SSE.

**Tech Stack:** SvelteKit 2.x · TypeScript · Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`) · Tavily (web search) · Jina Reader (extraction) · Vitest (tests) · simple-git (vault autocommit) · Node `fs`.

**Spec:** `docs/superpowers/specs/2026-06-17-universal-search-design.md`

---

## File Structure

```
universal-search/
├── package.json                       # deps + scripts
├── svelte.config.js                   # adapter-node
├── vite.config.ts                     # vitest config
├── tsconfig.json
├── .env.example                       # config template
├── src/
│   ├── lib/server/
│   │   ├── config.ts                  # load + validate env -> AppConfig
│   │   ├── ids.ts                     # runId + slugify
│   │   ├── events.ts                  # SSE RunEvent types + per-run event bus
│   │   ├── llm/
│   │   │   ├── client.ts              # provider-agnostic generateText/streamText
│   │   │   └── models.ts              # list selectable models (+fallback)
│   │   ├── search/
│   │   │   ├── types.ts               # SourceResult, SourceRunner
│   │   │   ├── tavily.ts              # web search runner
│   │   │   └── jina.ts                # getMarkdown(url)
│   │   ├── pipeline/
│   │   │   ├── propose.ts             # question -> Tavily queries (cheap model)
│   │   │   ├── compress.ts            # source markdown -> compressed evidence
│   │   │   ├── template.ts            # default "smart-research" report template
│   │   │   └── synthesize.ts          # evidence -> report (strong model)
│   │   ├── runs/
│   │   │   ├── types.ts               # Run, RunStatus, RunPlan, Evidence
│   │   │   ├── store.ts               # atomic saveRun/getRun/queryRuns
│   │   │   └── machine.ts             # orchestrates the run, emits events
│   │   └── vault/
│   │       ├── slug.ts                # (re-exported from ids.ts for vault use)
│   │       ├── paths.ts               # assert-inside-vault path safety
│   │       ├── frontmatter.ts         # build vault frontmatter + serialize
│   │       ├── writer.ts              # build deposit plan + atomic writes
│   │       └── git.ts                 # dirty-check + autocommit (simple-git)
│   └── routes/
│       ├── +page.svelte               # single-page UI
│       └── api/
│           ├── models/+server.ts      # GET model list
│           └── run/
│               ├── +server.ts         # POST create run -> proposing
│               └── [id]/
│                   ├── stream/+server.ts   # GET SSE
│                   ├── plan/+server.ts     # POST edited plan -> search+synth
│                   └── deposit/+server.ts  # POST confirm -> write
└── tests co-located as *.test.ts
```

**Boundary rules baked into the plan:**
- Everything under `src/lib/server/` is server-only (never imported by `.svelte` UI). The LLM SDK and `node:fs`/`simple-git` live here.
- Pure logic (`config`, `ids`, `slug`, `paths`, `frontmatter`, `template`, `store` atomic write, prompt builders) is TDD'd unit-by-unit.
- I/O adapters (`tavily`, `jina`, `git`, routes, UI) get complete code + a manual/integration verification step.

---

## Milestone 0 — Scaffold & Config

### Task 0.1: Initialize the SvelteKit project

**Files:**
- Create: `package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `src/app.d.ts`, `src/app.html`

- [ ] **Step 1: Scaffold a SvelteKit skeleton (non-interactive) into the existing repo**

Run:
```bash
cd /Users/admin/ai-developer/universal-search
npx sv create . --template minimal --types ts --no-add-ons --no-install
```
Expected: creates `src/`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `package.json`. If `sv` prompts about a non-empty directory, accept (the repo only has `README.md` + `docs/`).

- [ ] **Step 2: Install the Node adapter + runtime deps + dev deps**

Run:
```bash
npm install @sveltejs/adapter-node
npm install ai @ai-sdk/openai-compatible simple-git
npm install -D vitest @types/node
```
Expected: all install without error.

- [ ] **Step 3: Point svelte.config.js at adapter-node**

`svelte.config.js`:
```js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter() }
};
export default config;
```

- [ ] **Step 4: Configure Vitest in vite.config.ts**

`vite.config.ts`:
```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
});
```

- [ ] **Step 5: Add npm scripts**

In `package.json`, ensure `"scripts"` contains:
```json
{
  "dev": "vite dev",
  "build": "vite build",
  "preview": "node build",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 6: Verify dev server boots**

Run: `npm run dev`
Expected: SvelteKit dev server starts on `http://localhost:5173` with no errors. Stop it with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold SvelteKit (adapter-node) + vitest"
```

### Task 0.2: Config loader (`config.ts`)

**Files:**
- Create: `src/lib/server/config.ts`
- Create: `.env.example`
- Test: `src/lib/server/config.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/server/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

const base = {
  VAULT_ROOT: '/tmp/vault',
  LLM_BASE_URL: 'https://api.openai.com/v1',
  LLM_API_KEY: 'sk-test',
  FANOUT_MODEL: 'gpt-4o-mini',
  SYNTH_MODEL: 'gpt-4o',
  TAVILY_API_KEY: 'tvly-test'
};

describe('loadConfig', () => {
  it('parses a full env into AppConfig', () => {
    const cfg = loadConfig({ ...base, LLM_MODELS: 'gpt-4o,gpt-4o-mini', JINA_API_KEY: 'jina-x' });
    expect(cfg.vaultRoot).toBe('/tmp/vault');
    expect(cfg.llm.fanoutModel).toBe('gpt-4o-mini');
    expect(cfg.llm.models).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(cfg.jina.apiKey).toBe('jina-x');
  });

  it('defaults models to [] and jina apiKey to undefined when absent', () => {
    const cfg = loadConfig(base);
    expect(cfg.llm.models).toEqual([]);
    expect(cfg.jina.apiKey).toBeUndefined();
  });

  it('throws a clear error when a required var is missing', () => {
    const { TAVILY_API_KEY, ...missing } = base;
    expect(() => loadConfig(missing)).toThrow(/TAVILY_API_KEY/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/lib/server/config.test.ts`
Expected: FAIL — `loadConfig` is not defined.

- [ ] **Step 3: Implement `config.ts`**

`src/lib/server/config.ts`:
```ts
export interface AppConfig {
  vaultRoot: string;
  llm: {
    baseURL: string;
    apiKey: string;
    fanoutModel: string;
    synthModel: string;
    models: string[]; // fallback allowlist when provider /models is unavailable
  };
  tavily: { apiKey: string };
  jina: { apiKey?: string };
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v || v.trim() === '') throw new Error(`Missing required env var: ${key}`);
  return v.trim();
}

export function loadConfig(env: Env = process.env): AppConfig {
  return {
    vaultRoot: required(env, 'VAULT_ROOT'),
    llm: {
      baseURL: required(env, 'LLM_BASE_URL'),
      apiKey: required(env, 'LLM_API_KEY'),
      fanoutModel: required(env, 'FANOUT_MODEL'),
      synthModel: required(env, 'SYNTH_MODEL'),
      models: (env.LLM_MODELS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    },
    tavily: { apiKey: required(env, 'TAVILY_API_KEY') },
    jina: { apiKey: env.JINA_API_KEY?.trim() || undefined }
  };
}

let cached: AppConfig | null = null;
/** Lazily load + cache from process.env for use in route handlers. */
export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/server/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `.env.example`**

`.env.example`:
```bash
VAULT_ROOT=/Users/admin/Documents/ObsidianVault
# —— LLM (default OpenAI; change base_url to switch to DeepSeek/compatible) ——
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
FANOUT_MODEL=gpt-4o-mini
SYNTH_MODEL=gpt-4o
# Optional fallback model allowlist for the UI selector (used when /models is unavailable)
LLM_MODELS=gpt-4o,gpt-4o-mini,o4-mini
# —— Search ——
TAVILY_API_KEY=tvly-...
JINA_API_KEY=
# DeepSeek example:
# LLM_BASE_URL=https://api.deepseek.com
# FANOUT_MODEL=deepseek-chat
# SYNTH_MODEL=deepseek-reasoner
```

- [ ] **Step 6: Ensure `.env` is gitignored**

Run:
```bash
grep -qxF '.env' .gitignore || printf '\n.env\n.runs/\n' >> .gitignore
```
Expected: `.gitignore` contains `.env` and `.runs/`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/config.ts src/lib/server/config.test.ts .env.example .gitignore
git commit -m "feat: env-driven AppConfig loader with validation"
```

---

## Milestone 1 — Provider-Agnostic Model Layer

### Task 1.1: IDs and slugify (`ids.ts`)

**Files:**
- Create: `src/lib/server/ids.ts`
- Test: `src/lib/server/ids.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/server/ids.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { slugify, newRunId } from './ids';

describe('slugify', () => {
  it('lowercases, strips unsafe chars, collapses dashes', () => {
    expect(slugify('Hello, World! / 2026')).toBe('hello-world-2026');
  });
  it('keeps CJK characters but drops slashes and colons', () => {
    expect(slugify('知识/沉淀: 范式')).toBe('知识-沉淀-范式');
  });
  it('truncates to 80 chars and trims trailing dashes', () => {
    const s = slugify('a'.repeat(200));
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith('-')).toBe(false);
  });
  it('falls back to "untitled" for empty input', () => {
    expect(slugify('!!!')).toBe('untitled');
  });
});

describe('newRunId', () => {
  it('produces a unique-looking id with the run- prefix', () => {
    const id = newRunId(() => 0.5, 1718600000000);
    expect(id).toMatch(/^run-[a-z0-9]+-[a-z0-9]+$/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/ids.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ids.ts`**

`src/lib/server/ids.ts`:
```ts
/** Filesystem-safe slug. Keeps unicode letters/numbers (incl. CJK), strips path/separator chars. */
export function slugify(input: string): string {
  const cleaned = input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\\/:*?"<>|]+/g, ' ')         // path-unsafe chars -> space
    .replace(/[^\p{L}\p{N}]+/gu, '-')       // any non letter/number run -> dash
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/g, '');
  return cleaned || 'untitled';
}

/** Time-ordered, collision-resistant run id. Injectable rng/now for deterministic tests. */
export function newRunId(rng: () => number = Math.random, now: number = Date.now()): string {
  const t = now.toString(36);
  const r = Math.floor(rng() * 1e9).toString(36);
  return `run-${t}-${r}`;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/ids.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/ids.ts src/lib/server/ids.test.ts
git commit -m "feat: slugify + runId helpers"
```

### Task 1.2: LLM client (`llm/client.ts`)

**Files:**
- Create: `src/lib/server/llm/client.ts`
- Test: `src/lib/server/llm/client.test.ts`

> Note: `client.ts` wraps the Vercel AI SDK. We test our role→model resolution and message shaping by injecting a fake `generateText`, not by hitting the network.

- [ ] **Step 1: Write the failing test**

`src/lib/server/llm/client.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { makeLlm } from './client';

const cfg = {
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  fanoutModel: 'gpt-4o-mini',
  synthModel: 'gpt-4o',
  models: []
};

describe('makeLlm.complete', () => {
  it('resolves role "fanout" to fanoutModel and returns text', async () => {
    const fakeGenerate = vi.fn().mockResolvedValue({ text: 'hi' });
    const llm = makeLlm(cfg, { generate: fakeGenerate, provider: (id: string) => ({ id }) as any });
    const out = await llm.complete({ role: 'fanout', system: 'S', prompt: 'P' });
    expect(out).toBe('hi');
    const arg = fakeGenerate.mock.calls[0][0];
    expect(arg.model.id).toBe('gpt-4o-mini');
    expect(arg.system).toBe('S');
    expect(arg.prompt).toBe('P');
  });

  it('honors an explicit model override over the role default', async () => {
    const fakeGenerate = vi.fn().mockResolvedValue({ text: 'ok' });
    const llm = makeLlm(cfg, { generate: fakeGenerate, provider: (id: string) => ({ id }) as any });
    await llm.complete({ role: 'synth', model: 'o4-mini', prompt: 'x' });
    expect(fakeGenerate.mock.calls[0][0].model.id).toBe('o4-mini');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/llm/client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `llm/client.ts`**

`src/lib/server/llm/client.ts`:
```ts
import { generateText, streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { AppConfig } from '../config';

type LlmConfig = AppConfig['llm'];
export type Role = 'fanout' | 'synth';

export interface CompleteArgs {
  role: Role;
  model?: string;
  system?: string;
  prompt: string;
}

// Injectable seam for tests.
interface Deps {
  generate: typeof generateText;
  provider: (modelId: string) => any;
}

export function makeLlm(cfg: LlmConfig, deps?: Partial<Deps>) {
  const provider =
    deps?.provider ??
    createOpenAICompatible({ name: 'llm', baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  const generate = deps?.generate ?? generateText;

  const resolve = (role: Role, override?: string) =>
    override ?? (role === 'fanout' ? cfg.fanoutModel : cfg.synthModel);

  return {
    /** Non-streaming completion -> string. */
    async complete(args: CompleteArgs): Promise<string> {
      const { text } = await generate({
        model: provider(resolve(args.role, args.model)),
        system: args.system,
        prompt: args.prompt
      });
      return text;
    },

    /** Streaming completion -> async iterable of text deltas (for synth). */
    stream(args: CompleteArgs) {
      const result = streamText({
        model: provider(resolve(args.role, args.model)),
        system: args.system,
        prompt: args.prompt
      });
      return result.textStream;
    }
  };
}

export type Llm = ReturnType<typeof makeLlm>;
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/llm/client.test.ts`
Expected: PASS (2 tests).

> If the AI SDK's `@ai-sdk/openai-compatible` provider factory signature differs in the installed version, adjust the `createOpenAICompatible(...)` call per its README; the injected-`provider` test seam is unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/llm/client.ts src/lib/server/llm/client.test.ts
git commit -m "feat: provider-agnostic LLM client (role->model, complete+stream)"
```

### Task 1.3: Model listing (`llm/models.ts`) + `/api/models`

**Files:**
- Create: `src/lib/server/llm/models.ts`
- Test: `src/lib/server/llm/models.test.ts`
- Create: `src/routes/api/models/+server.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/server/llm/models.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { listModels } from './models';

const cfg = { baseURL: 'https://api.openai.com/v1', apiKey: 'sk', fanoutModel: 'a', synthModel: 'b', models: ['fallback-1'] };

describe('listModels', () => {
  it('returns model ids from the provider /models endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] })
    });
    const ids = await listModels(cfg, fetchFn as any);
    expect(ids).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(fetchFn).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer sk' })
    }));
  });

  it('falls back to cfg.models when the endpoint errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const ids = await listModels(cfg, fetchFn as any);
    expect(ids).toEqual(['fallback-1']);
  });

  it('falls back when fetch throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network'));
    const ids = await listModels(cfg, fetchFn as any);
    expect(ids).toEqual(['fallback-1']);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/llm/models.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `llm/models.ts`**

`src/lib/server/llm/models.ts`:
```ts
import type { AppConfig } from '../config';

/** List selectable model ids. Tries the provider's OpenAI-compatible /models, falls back to cfg.models. */
export async function listModels(
  cfg: AppConfig['llm'],
  fetchFn: typeof fetch = fetch
): Promise<string[]> {
  try {
    const res = await fetchFn(`${cfg.baseURL.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` }
    });
    if (!res.ok) return cfg.models;
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = (body.data ?? []).map((m) => m.id).filter(Boolean);
    return ids.length ? ids : cfg.models;
  } catch {
    return cfg.models;
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/llm/models.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the route**

`src/routes/api/models/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import { getConfig } from '$lib/server/config';
import { listModels } from '$lib/server/llm/models';

export async function GET() {
  const cfg = getConfig();
  const models = await listModels(cfg.llm);
  return json({
    models,
    defaults: { fanout: cfg.llm.fanoutModel, synth: cfg.llm.synthModel }
  });
}
```

- [ ] **Step 6: Manually verify the route**

Run (with a real `.env` copied from `.env.example`): `npm run dev`, then in another terminal:
```bash
curl -s localhost:5173/api/models
```
Expected: JSON `{ "models": [...], "defaults": { "fanout": "...", "synth": "..." } }`. (If the key is invalid, you should still get the fallback `LLM_MODELS`.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/llm/models.ts src/lib/server/llm/models.test.ts src/routes/api/models/+server.ts
git commit -m "feat: model listing with fallback + /api/models"
```

---

## Milestone 2 — Run Types & Atomic Persistence

### Task 2.1: Run domain types (`runs/types.ts`)

**Files:**
- Create: `src/lib/server/runs/types.ts`

- [ ] **Step 1: Create the types (no test — pure declarations)**

`src/lib/server/runs/types.ts`:
```ts
import type { Frontmatter } from '../vault/frontmatter';

export type RunStatus =
  | 'proposing'
  | 'awaiting_edit'
  | 'searching'
  | 'synthesizing'
  | 'awaiting_deposit'
  | 'depositing'
  | 'done'
  | 'error';

export interface PlanSource {
  id: string;
  api: 'tavily';
  query: string;
  enabled: boolean;
}

export interface PlanDimension {
  key: 'web';
  label: string;
  enabled: boolean;
  sources: PlanSource[];
}

export interface RunPlan {
  dimensions: PlanDimension[];
}

export interface Evidence {
  sourceId: string;
  url: string;
  title: string;
  compressed: string;
  retrievedAt: string;
}

export interface DepositFile {
  path: string; // vault-relative
  kind: 'synthesis' | 'raw';
  contents: string;
}

export interface ReportData {
  templateKey: 'smart-default';
  frontmatter: Frontmatter;
  markdown: string;
}

export interface Run {
  id: string;
  createdAt: string;
  status: RunStatus;
  question: string;
  models: { fanout: string; synth: string };
  plan: RunPlan;
  evidence: Evidence[];
  report?: ReportData;
  depositPlan?: { files: DepositFile[]; reportPath: string };
  error?: { stage: RunStatus; message: string };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/runs/types.ts
git commit -m "feat: Run domain types"
```

### Task 2.2: Atomic run store (`runs/store.ts`)

**Files:**
- Create: `src/lib/server/runs/store.ts`
- Test: `src/lib/server/runs/store.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/server/runs/store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRunStore } from './store';
import type { Run } from './types';

function sampleRun(id: string): Run {
  return {
    id, createdAt: '2026-06-17T00:00:00.000Z', status: 'proposing',
    question: 'q', models: { fanout: 'a', synth: 'b' },
    plan: { dimensions: [] }, evidence: []
  };
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'runs-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('makeRunStore', () => {
  it('saves and reloads a run', async () => {
    const store = makeRunStore(dir);
    await store.save(sampleRun('run-1'));
    const got = await store.get('run-1');
    expect(got?.question).toBe('q');
  });

  it('writes atomically (no .tmp file left behind)', async () => {
    const store = makeRunStore(dir);
    await store.save(sampleRun('run-2'));
    const files = await readdir(dir);
    expect(files).toContain('run-2.json');
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('queryRuns returns newest-first summaries', async () => {
    const store = makeRunStore(dir);
    await store.save({ ...sampleRun('run-a'), createdAt: '2026-06-01T00:00:00.000Z' });
    await store.save({ ...sampleRun('run-b'), createdAt: '2026-06-10T00:00:00.000Z' });
    const list = await store.query();
    expect(list.map((r) => r.id)).toEqual(['run-b', 'run-a']);
  });

  it('get returns null for missing id', async () => {
    const store = makeRunStore(dir);
    expect(await store.get('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/runs/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runs/store.ts`**

`src/lib/server/runs/store.ts`:
```ts
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Run, RunStatus } from './types';

export interface RunSummary {
  id: string;
  createdAt: string;
  status: RunStatus;
  question: string;
}

export function makeRunStore(dir: string) {
  const ensure = async () => { await mkdir(dir, { recursive: true }); };
  const file = (id: string) => join(dir, `${id}.json`);

  return {
    async save(run: Run): Promise<void> {
      await ensure();
      const tmp = join(dir, `${run.id}.${Date.now()}.tmp`);
      await writeFile(tmp, JSON.stringify(run, null, 2), 'utf8');
      await rename(tmp, file(run.id)); // atomic on same filesystem
    },

    async get(id: string): Promise<Run | null> {
      try {
        return JSON.parse(await readFile(file(id), 'utf8')) as Run;
      } catch (err: any) {
        if (err?.code === 'ENOENT') return null;
        throw err;
      }
    },

    async query(): Promise<RunSummary[]> {
      await ensure();
      const names = (await readdir(dir)).filter((n) => n.endsWith('.json'));
      const runs = await Promise.all(
        names.map(async (n) => {
          try {
            const r = JSON.parse(await readFile(join(dir, n), 'utf8')) as Run;
            return { id: r.id, createdAt: r.createdAt, status: r.status, question: r.question };
          } catch {
            return null;
          }
        })
      );
      return runs
        .filter((r): r is RunSummary => r !== null)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }
  };
}

export type RunStore = ReturnType<typeof makeRunStore>;
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/runs/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/runs/store.ts src/lib/server/runs/store.test.ts
git commit -m "feat: atomic JSON run store (save/get/query)"
```

---

## Milestone 3 — Search & Extraction Adapters

### Task 3.1: Search types (`search/types.ts`)

**Files:**
- Create: `src/lib/server/search/types.ts`

- [ ] **Step 1: Create the interfaces**

`src/lib/server/search/types.ts`:
```ts
export interface SourceResult {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
}

export interface SourceRunner {
  dimension: 'web' | 'community' | 'peoples_writing' | 'images';
  api: string;
  run(query: string): Promise<SourceResult[]>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/search/types.ts
git commit -m "feat: SourceRunner/SourceResult interfaces"
```

### Task 3.2: Tavily web runner (`search/tavily.ts`)

**Files:**
- Create: `src/lib/server/search/tavily.ts`
- Test: `src/lib/server/search/tavily.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/server/search/tavily.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { makeTavilyRunner } from './tavily';

describe('makeTavilyRunner', () => {
  it('POSTs the query and maps results to SourceResult[]', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { url: 'https://a.com', title: 'A', content: 'snippet A', published_date: '2026-01-01' },
          { url: 'https://b.com', title: 'B', content: 'snippet B' }
        ]
      })
    });
    const runner = makeTavilyRunner('tvly-x', fetchFn as any);
    const out = await runner.run('hello');

    expect(out).toEqual([
      { url: 'https://a.com', title: 'A', snippet: 'snippet A', publishedAt: '2026-01-01' },
      { url: 'https://b.com', title: 'B', snippet: 'snippet B', publishedAt: undefined }
    ]);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.tavily.com/search');
    expect(JSON.parse(init.body).query).toBe('hello');
  });

  it('throws a descriptive error on non-ok response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' });
    const runner = makeTavilyRunner('tvly-x', fetchFn as any);
    await expect(runner.run('q')).rejects.toThrow(/Tavily 401/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/search/tavily.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `search/tavily.ts`**

`src/lib/server/search/tavily.ts`:
```ts
import type { SourceResult, SourceRunner } from './types';

interface TavilyResult {
  url: string;
  title: string;
  content: string;
  published_date?: string;
}

export function makeTavilyRunner(apiKey: string, fetchFn: typeof fetch = fetch): SourceRunner {
  return {
    dimension: 'web',
    api: 'tavily',
    async run(query: string): Promise<SourceResult[]> {
      const res = await fetchFn('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          max_results: 5,
          include_answer: false
        })
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Tavily ${res.status}: ${detail}`);
      }
      const body = (await res.json()) as { results?: TavilyResult[] };
      return (body.results ?? []).map((r) => ({
        url: r.url,
        title: r.title,
        snippet: r.content,
        publishedAt: r.published_date
      }));
    }
  };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/search/tavily.test.ts`
Expected: PASS (2 tests).

> Verify the Tavily auth style against current docs during implementation: newer Tavily accepts `Authorization: Bearer <key>`; some versions expect `api_key` in the JSON body. If 401s occur with a valid key, add `api_key: apiKey` to the body.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/search/tavily.ts src/lib/server/search/tavily.test.ts
git commit -m "feat: Tavily web search runner"
```

### Task 3.3: Jina extractor (`search/jina.ts`)

**Files:**
- Create: `src/lib/server/search/jina.ts`
- Test: `src/lib/server/search/jina.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/server/search/jina.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { makeJinaExtractor } from './jina';

describe('makeJinaExtractor', () => {
  it('fetches r.jina.ai/<url> and returns markdown text', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, text: async () => '# Title\nbody' });
    const extract = makeJinaExtractor(undefined, fetchFn as any);
    const md = await extract('https://example.com/post');
    expect(md).toBe('# Title\nbody');
    expect(fetchFn.mock.calls[0][0]).toBe('https://r.jina.ai/https://example.com/post');
  });

  it('adds Authorization header when an api key is provided', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, text: async () => 'x' });
    const extract = makeJinaExtractor('jina-key', fetchFn as any);
    await extract('https://e.com');
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer jina-key');
  });

  it('returns empty string (does not throw) on failure so one bad source cannot kill the run', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    const extract = makeJinaExtractor(undefined, fetchFn as any);
    expect(await extract('https://e.com')).toBe('');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/search/jina.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `search/jina.ts`**

`src/lib/server/search/jina.ts`:
```ts
/** Returns clean markdown for a URL via Jina Reader. Returns '' on failure (caller degrades gracefully). */
export function makeJinaExtractor(apiKey: string | undefined, fetchFn: typeof fetch = fetch) {
  return async function extract(url: string): Promise<string> {
    try {
      const headers: Record<string, string> = { 'X-Return-Format': 'markdown' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetchFn(`https://r.jina.ai/${url}`, { headers });
      if (!res.ok) return '';
      return await res.text();
    } catch {
      return '';
    }
  };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/search/jina.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/search/jina.ts src/lib/server/search/jina.test.ts
git commit -m "feat: Jina Reader extractor (graceful-degrade)"
```

---

## Milestone 4 — Pipeline Logic (prompts, compress, template, synthesize)

### Task 4.1: Propose queries (`pipeline/propose.ts`)

**Files:**
- Create: `src/lib/server/pipeline/propose.ts`
- Test: `src/lib/server/pipeline/propose.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/server/pipeline/propose.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildProposePrompt, parseProposedQueries } from './propose';

describe('buildProposePrompt', () => {
  it('embeds the question and asks for a JSON array of web queries', () => {
    const p = buildProposePrompt('How does RAG work?');
    expect(p).toContain('How does RAG work?');
    expect(p.toLowerCase()).toContain('json');
  });
});

describe('parseProposedQueries', () => {
  it('extracts queries from a clean JSON array', () => {
    expect(parseProposedQueries('["a","b","c"]')).toEqual(['a', 'b', 'c']);
  });
  it('extracts a JSON array embedded in prose / code fences', () => {
    const raw = 'Sure!\n```json\n["x", "y"]\n```';
    expect(parseProposedQueries(raw)).toEqual(['x', 'y']);
  });
  it('caps at 3 and drops empties', () => {
    expect(parseProposedQueries('["a","","b","c","d"]')).toEqual(['a', 'b', 'c']);
  });
  it('throws when no array can be found', () => {
    expect(() => parseProposedQueries('no json here')).toThrow(/parse/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/pipeline/propose.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pipeline/propose.ts`**

`src/lib/server/pipeline/propose.ts`:
```ts
export function buildProposePrompt(question: string): string {
  return [
    'You plan web searches for a research question.',
    'Output ONLY a JSON array of 2-3 concise, high-signal web search query strings',
    'that together cover the question from complementary angles.',
    'No prose, no keys — just the array.',
    '',
    `Question: ${question}`
  ].join('\n');
}

export function parseProposedQueries(raw: string): string[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Could not parse query array from model output: ${raw.slice(0, 120)}`);
  let arr: unknown;
  try {
    arr = JSON.parse(match[0]);
  } catch {
    throw new Error(`Could not parse query array (invalid JSON): ${match[0].slice(0, 120)}`);
  }
  if (!Array.isArray(arr)) throw new Error('Parsed value is not an array');
  return arr
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 3);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/pipeline/propose.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/pipeline/propose.ts src/lib/server/pipeline/propose.test.ts
git commit -m "feat: propose-queries prompt + robust parse"
```

### Task 4.2: Compress source (`pipeline/compress.ts`)

**Files:**
- Create: `src/lib/server/pipeline/compress.ts`
- Test: `src/lib/server/pipeline/compress.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/server/pipeline/compress.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildCompressPrompt, truncateForBudget } from './compress';

describe('buildCompressPrompt', () => {
  it('includes question, source title and the (truncated) content', () => {
    const p = buildCompressPrompt('Q?', 'Title', 'long content here');
    expect(p).toContain('Q?');
    expect(p).toContain('Title');
    expect(p).toContain('long content here');
  });
});

describe('truncateForBudget', () => {
  it('returns text unchanged when under the cap', () => {
    expect(truncateForBudget('short', 100)).toBe('short');
  });
  it('truncates and marks elision when over the cap', () => {
    const out = truncateForBudget('a'.repeat(50), 10);
    expect(out.length).toBeLessThan(50);
    expect(out).toContain('…[truncated]');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/pipeline/compress.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pipeline/compress.ts`**

`src/lib/server/pipeline/compress.ts`:
```ts
/** Char-budget guard so a huge page can't blow up the fanout token cost. ~4 chars/token heuristic. */
export function truncateForBudget(text: string, maxChars = 12000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n…[truncated]';
}

export function buildCompressPrompt(question: string, title: string, content: string): string {
  return [
    'Extract only the facts from this source that help answer the question.',
    'Write 4-8 dense bullet points. Preserve concrete numbers, names, and claims.',
    'If the source is irrelevant, reply exactly: IRRELEVANT.',
    '',
    `Question: ${question}`,
    `Source title: ${title}`,
    '--- SOURCE START ---',
    truncateForBudget(content),
    '--- SOURCE END ---'
  ].join('\n');
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/pipeline/compress.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/pipeline/compress.ts src/lib/server/pipeline/compress.test.ts
git commit -m "feat: per-source compression prompt + budget truncation"
```

### Task 4.3: Default report template (`pipeline/template.ts`)

**Files:**
- Create: `src/lib/server/pipeline/template.ts`
- Test: `src/lib/server/pipeline/template.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/server/pipeline/template.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildSynthesisPrompt, SMART_DEFAULT_SECTIONS } from './template';
import type { Evidence } from '../runs/types';

const evidence: Evidence[] = [
  { sourceId: 's1', url: 'https://a.com', title: 'A', compressed: '- fact 1', retrievedAt: '2026-06-17' }
];

describe('buildSynthesisPrompt', () => {
  it('lists every default section heading', () => {
    const p = buildSynthesisPrompt('Q?', evidence);
    for (const h of SMART_DEFAULT_SECTIONS) expect(p).toContain(h);
  });
  it('embeds the question and the evidence with numbered citations', () => {
    const p = buildSynthesisPrompt('Q?', evidence);
    expect(p).toContain('Q?');
    expect(p).toContain('[1]');
    expect(p).toContain('https://a.com');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/pipeline/template.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pipeline/template.ts`**

`src/lib/server/pipeline/template.ts`:
```ts
import type { Evidence } from '../runs/types';

export const SMART_DEFAULT_SECTIONS = [
  '## 问题界定',
  '## 核心发现',
  '## 详细展开',
  '## 分歧与警示',
  '## 开放问题',
  '## 行动项',
  '## 来源'
];

export function buildSynthesisPrompt(question: string, evidence: Evidence[]): string {
  const sources = evidence
    .map((e, i) => `[${i + 1}] ${e.title} — ${e.url}\n${e.compressed}`)
    .join('\n\n');

  return [
    'You are a careful research analyst. Write a detailed report in Chinese (Markdown).',
    'Use EXACTLY these section headings in this order:',
    SMART_DEFAULT_SECTIONS.join('\n'),
    '',
    'Rules:',
    '- Start with a 1-2 sentence executive answer as a blockquote (>) under the H1 title.',
    '- In 核心发现, every claim ends with an inline citation like [1] and a confidence tag (置信度: 高/中/低).',
    '- In 来源, list each numbered source with its URL.',
    '- Only use the evidence provided. If evidence is thin, say so in 分歧与警示 / 开放问题.',
    '- Begin the document with an H1 line: "# " followed by a faithful restatement of the question.',
    '',
    `Question: ${question}`,
    '',
    '=== EVIDENCE ===',
    sources
  ].join('\n');
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/pipeline/template.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/pipeline/template.ts src/lib/server/pipeline/template.test.ts
git commit -m "feat: default smart-research synthesis prompt/template"
```

---

## Milestone 5 — Vault Deposit & Safety

### Task 5.1: Path safety (`vault/paths.ts`)

**Files:**
- Create: `src/lib/server/vault/paths.ts`
- Test: `src/lib/server/vault/paths.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/server/vault/paths.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveInsideVault } from './paths';

const VAULT = '/Users/admin/Documents/ObsidianVault';

describe('resolveInsideVault', () => {
  it('resolves a normal relative path inside the vault', () => {
    expect(resolveInsideVault(VAULT, 'wiki/synthesis/x.md')).toBe(`${VAULT}/wiki/synthesis/x.md`);
  });
  it('rejects path traversal with ../', () => {
    expect(() => resolveInsideVault(VAULT, '../evil.md')).toThrow(/outside vault/i);
  });
  it('rejects absolute paths that escape the vault', () => {
    expect(() => resolveInsideVault(VAULT, '/etc/passwd')).toThrow(/outside vault/i);
  });
  it('rejects sneaky nested traversal', () => {
    expect(() => resolveInsideVault(VAULT, 'wiki/../../escape.md')).toThrow(/outside vault/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/vault/paths.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `vault/paths.ts`**

`src/lib/server/vault/paths.ts`:
```ts
import { resolve, sep } from 'node:path';

/** Resolve a vault-relative path and HARD-FAIL if it escapes the vault root. */
export function resolveInsideVault(vaultRoot: string, relPath: string): string {
  const root = resolve(vaultRoot);
  const abs = resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`Refusing to write outside vault: ${relPath}`);
  }
  return abs;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/vault/paths.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/vault/paths.ts src/lib/server/vault/paths.test.ts
git commit -m "feat: assert-inside-vault path safety"
```

### Task 5.2: Frontmatter builder (`vault/frontmatter.ts`)

**Files:**
- Create: `src/lib/server/vault/frontmatter.ts`
- Test: `src/lib/server/vault/frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/server/vault/frontmatter.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildFrontmatter, serializeFrontmatter } from './frontmatter';

describe('buildFrontmatter', () => {
  it('produces the vault synthesis schema', () => {
    const fm = buildFrontmatter({
      title: '什么是 RAG',
      date: '2026-06-17',
      tags: ['AI', 'RAG'],
      sources: ['raw/research/2026-06-17-rag/1-a.md', 'https://a.com'],
      related: []
    });
    expect(fm.type).toBe('synthesis');
    expect(fm.status).toBe('draft');
    expect(fm.confidence).toBe('medium');
    expect(fm.created).toBe('2026-06-17');
    expect(fm.updated).toBe('2026-06-17');
  });
});

describe('serializeFrontmatter', () => {
  it('emits YAML between --- fences with array fields inline', () => {
    const fm = buildFrontmatter({ title: 'T', date: '2026-06-17', tags: ['a', 'b'], sources: ['s'], related: [] });
    const out = serializeFrontmatter(fm);
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('type: synthesis');
    expect(out).toContain('tags: [a, b]');
    expect(out).toContain('related: []');
    expect(out.trim().endsWith('---')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/vault/frontmatter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `vault/frontmatter.ts`**

`src/lib/server/vault/frontmatter.ts`:
```ts
export interface Frontmatter {
  title: string;
  type: 'synthesis';
  created: string;
  updated: string;
  tags: string[];
  sources: string[];
  related: string[];
  confidence: 'high' | 'medium' | 'low';
  status: 'draft';
}

export function buildFrontmatter(input: {
  title: string;
  date: string;
  tags: string[];
  sources: string[];
  related: string[];
}): Frontmatter {
  return {
    title: input.title,
    type: 'synthesis',
    created: input.date,
    updated: input.date,
    tags: input.tags,
    sources: input.sources,
    related: input.related,
    confidence: 'medium',
    status: 'draft'
  };
}

const yamlString = (s: string) => (/[:#\-\[\]{}]/.test(s) ? JSON.stringify(s) : s);
const yamlArray = (a: string[]) => `[${a.map(yamlString).join(', ')}]`;

export function serializeFrontmatter(fm: Frontmatter): string {
  return [
    '---',
    `title: ${yamlString(fm.title)}`,
    `type: ${fm.type}`,
    `created: ${fm.created}`,
    `updated: ${fm.updated}`,
    `tags: ${yamlArray(fm.tags)}`,
    `sources: ${yamlArray(fm.sources)}`,
    `related: ${yamlArray(fm.related)}`,
    `confidence: ${fm.confidence}`,
    `status: ${fm.status}`,
    '---'
  ].join('\n');
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/vault/frontmatter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/vault/frontmatter.ts src/lib/server/vault/frontmatter.test.ts
git commit -m "feat: vault frontmatter builder + YAML serializer"
```

### Task 5.3: Deposit-plan builder (`vault/writer.ts`)

**Files:**
- Create: `src/lib/server/vault/writer.ts`
- Test: `src/lib/server/vault/writer.test.ts`

> `writer.ts` has two parts: a PURE `buildDepositPlan` (tested here) and an I/O `writeDepositPlan` (verified in Task 7's integration step).

- [ ] **Step 1: Write the failing test**

`src/lib/server/vault/writer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildDepositPlan } from './writer';
import type { Evidence } from '../runs/types';
import { buildFrontmatter } from './frontmatter';

const evidence: Evidence[] = [
  { sourceId: 's1', url: 'https://a.com', title: 'Alpha', compressed: '- a', retrievedAt: '2026-06-17' },
  { sourceId: 's2', url: 'https://b.com', title: 'Beta', compressed: '- b', retrievedAt: '2026-06-17' }
];

describe('buildDepositPlan', () => {
  const fm = buildFrontmatter({ title: '什么是 RAG', date: '2026-06-17', tags: ['RAG'], sources: [], related: [] });
  const plan = buildDepositPlan({ slug: '什么是-rag', date: '2026-06-17', frontmatter: fm, reportBody: '# 什么是 RAG\n...', evidence });

  it('writes the synthesis report to wiki/synthesis/<slug>.md', () => {
    const report = plan.files.find((f) => f.kind === 'synthesis')!;
    expect(report.path).toBe('wiki/synthesis/什么是-rag.md');
    expect(report.contents).toContain('type: synthesis');
    expect(report.contents).toContain('# 什么是 RAG');
  });

  it('writes one raw snapshot per source under raw/research/<date>-<slug>/', () => {
    const raws = plan.files.filter((f) => f.kind === 'raw');
    expect(raws).toHaveLength(2);
    expect(raws[0].path).toBe('raw/research/2026-06-17-什么是-rag/1-alpha.md');
    expect(raws[1].path).toBe('raw/research/2026-06-17-什么是-rag/2-beta.md');
    expect(raws[0].contents).toContain('https://a.com');
  });

  it('reportPath points at the synthesis file', () => {
    expect(plan.reportPath).toBe('wiki/synthesis/什么是-rag.md');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/vault/writer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure part of `vault/writer.ts`**

`src/lib/server/vault/writer.ts`:
```ts
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Evidence, DepositFile } from '../runs/types';
import type { Frontmatter } from './frontmatter';
import { serializeFrontmatter } from './frontmatter';
import { slugify } from '../ids';
import { resolveInsideVault } from './paths';

export interface DepositPlan {
  files: DepositFile[];
  reportPath: string;
}

export function buildDepositPlan(input: {
  slug: string;
  date: string;
  frontmatter: Frontmatter;
  reportBody: string;
  evidence: Evidence[];
}): DepositPlan {
  const { slug, date, frontmatter, reportBody, evidence } = input;
  const reportPath = `wiki/synthesis/${slug}.md`;
  const rawDir = `raw/research/${date}-${slug}`;

  const files: DepositFile[] = [];

  files.push({
    path: reportPath,
    kind: 'synthesis',
    contents: `${serializeFrontmatter(frontmatter)}\n\n${reportBody}\n`
  });

  evidence.forEach((e, i) => {
    const fname = `${i + 1}-${slugify(e.title)}.md`;
    files.push({
      path: `${rawDir}/${fname}`,
      kind: 'raw',
      contents: [
        `# ${e.title}`,
        `- URL: ${e.url}`,
        `- Retrieved: ${e.retrievedAt}`,
        '',
        e.compressed
      ].join('\n')
    });
  });

  return { files, reportPath };
}

/** Atomically write every file in the plan, asserting each path stays inside the vault. */
export async function writeDepositPlan(vaultRoot: string, plan: DepositPlan): Promise<void> {
  for (const f of plan.files) {
    const abs = resolveInsideVault(vaultRoot, f.path);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.${Date.now()}.tmp`;
    await writeFile(tmp, f.contents, 'utf8');
    await rename(tmp, abs);
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/vault/writer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/vault/writer.ts src/lib/server/vault/writer.test.ts
git commit -m "feat: deposit-plan builder + atomic vault writer"
```

### Task 5.4: Git guard + autocommit (`vault/git.ts`)

**Files:**
- Create: `src/lib/server/vault/git.ts`
- Test: `src/lib/server/vault/git.test.ts` (integration: real temp git repo)

- [ ] **Step 1: Write the failing integration test**

`src/lib/server/vault/git.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { assertCleanVault, autocommit } from './git';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vault-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 't@t.co');
  await git.addConfig('user.name', 'T');
  await writeFile(join(dir, 'seed.md'), 'seed');
  await git.add('.');
  await git.commit('init');
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('assertCleanVault', () => {
  it('passes when the tree is clean', async () => {
    await expect(assertCleanVault(dir)).resolves.toBeUndefined();
  });
  it('throws when the tree is dirty', async () => {
    await writeFile(join(dir, 'dirty.md'), 'x');
    await expect(assertCleanVault(dir)).rejects.toThrow(/dirty/i);
  });
});

describe('autocommit', () => {
  it('stages the given files and commits, returning a short sha', async () => {
    await mkdir(join(dir, 'wiki', 'synthesis'), { recursive: true });
    await writeFile(join(dir, 'wiki/synthesis/x.md'), 'report');
    const sha = await autocommit(dir, ['wiki/synthesis/x.md'], 'ingest: x');
    expect(sha).toMatch(/^[0-9a-f]{7,}$/);
    const log = await simpleGit(dir).log();
    expect(log.latest?.message).toContain('ingest: x');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/vault/git.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `vault/git.ts`**

`src/lib/server/vault/git.ts`:
```ts
import { simpleGit } from 'simple-git';

/** HARD-FAIL if the vault has uncommitted changes, so we never co-mingle commits. */
export async function assertCleanVault(vaultRoot: string): Promise<void> {
  const status = await simpleGit(vaultRoot).status();
  if (!status.isClean()) {
    throw new Error(
      `Vault git tree is dirty (${status.files.length} changed file(s)). ` +
        'Commit or stash your vault changes before running a deposit.'
    );
  }
}

/** Stage the given vault-relative files and commit. Returns the short sha. */
export async function autocommit(vaultRoot: string, files: string[], message: string): Promise<string> {
  const git = simpleGit(vaultRoot);
  await git.add(files);
  await git.commit(message);
  const sha = await git.revparse(['--short', 'HEAD']);
  return sha.trim();
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/vault/git.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/vault/git.ts src/lib/server/vault/git.test.ts
git commit -m "feat: vault dirty-check guard + autocommit"
```

---

## Milestone 6 — Event Bus & Orchestration Machine

### Task 6.1: SSE event types + per-run bus (`events.ts`)

**Files:**
- Create: `src/lib/server/events.ts`
- Test: `src/lib/server/events.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/server/events.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { makeEventBus } from './events';

describe('makeEventBus', () => {
  it('delivers events emitted after subscribe', async () => {
    const bus = makeEventBus();
    const got: string[] = [];
    const unsub = bus.subscribe('run-1', (e) => got.push(e.phase));
    bus.emit('run-1', { phase: 'proposing' });
    bus.emit('run-1', { phase: 'done', reportPath: 'p' });
    unsub();
    bus.emit('run-1', { phase: 'error', message: 'after-unsub' });
    expect(got).toEqual(['proposing', 'done']);
  });

  it('isolates events by runId', () => {
    const bus = makeEventBus();
    const a: string[] = [];
    bus.subscribe('run-a', (e) => a.push(e.phase));
    bus.emit('run-b', { phase: 'proposing' });
    expect(a).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/events.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `events.ts`**

`src/lib/server/events.ts`:
```ts
import type { RunPlan, DepositFile } from './runs/types';

export type RunEvent =
  | { phase: 'proposing' }
  | { phase: 'awaiting_edit'; plan: RunPlan }
  | { phase: 'querying'; sourceId: string; status: 'start' | 'ok' | 'fail'; title?: string }
  | { phase: 'synthesizing'; delta?: string }
  | { phase: 'awaiting_deposit'; files: DepositFile[]; markdown: string }
  | { phase: 'done'; reportPath: string; sha?: string }
  | { phase: 'error'; message: string }
  | { phase: 'heartbeat' };

type Listener = (e: RunEvent) => void;

export function makeEventBus() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    subscribe(runId: string, fn: Listener): () => void {
      if (!listeners.has(runId)) listeners.set(runId, new Set());
      listeners.get(runId)!.add(fn);
      return () => listeners.get(runId)?.delete(fn);
    },
    emit(runId: string, e: RunEvent): void {
      listeners.get(runId)?.forEach((fn) => fn(e));
    }
  };
}

export type EventBus = ReturnType<typeof makeEventBus>;

// Single process-wide bus shared by routes + machine.
export const bus: EventBus = makeEventBus();
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/events.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/events.ts src/lib/server/events.test.ts
git commit -m "feat: SSE RunEvent types + per-run event bus"
```

### Task 6.2: Dependency container (`runs/deps.ts`)

**Files:**
- Create: `src/lib/server/runs/deps.ts`

> One place that wires real config + adapters together, so the machine is testable with fakes.

- [ ] **Step 1: Implement `runs/deps.ts`**

`src/lib/server/runs/deps.ts`:
```ts
import { getConfig } from '../config';
import { makeLlm, type Llm } from '../llm/client';
import { makeTavilyRunner } from '../search/tavily';
import { makeJinaExtractor } from '../search/jina';
import { makeRunStore, type RunStore } from './store';
import type { SourceRunner } from '../search/types';
import { join } from 'node:path';

export interface MachineDeps {
  vaultRoot: string;
  llm: Llm;
  web: SourceRunner;
  extract: (url: string) => Promise<string>;
  store: RunStore;
  now: () => Date;
}

export function realDeps(): MachineDeps {
  const cfg = getConfig();
  return {
    vaultRoot: cfg.vaultRoot,
    llm: makeLlm(cfg.llm),
    web: makeTavilyRunner(cfg.tavily.apiKey),
    extract: makeJinaExtractor(cfg.jina.apiKey),
    store: makeRunStore(join(process.cwd(), '.runs')),
    now: () => new Date()
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/runs/deps.ts
git commit -m "feat: machine dependency container (real adapters)"
```

### Task 6.3: Orchestration machine (`runs/machine.ts`)

**Files:**
- Create: `src/lib/server/runs/machine.ts`
- Test: `src/lib/server/runs/machine.test.ts`

> The machine drives: propose → (pause) → search+compress → synthesize → (pause) → deposit. Tested end-to-end with fakes; no network, no real vault.

- [ ] **Step 1: Write the failing test**

`src/lib/server/runs/machine.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRunStore } from './store';
import { makeEventBus } from '../events';
import { startRun, runPlan } from './machine';
import type { MachineDeps } from './deps';
import type { Run } from './types';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'm-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function fakeDeps(over: Partial<MachineDeps> = {}): MachineDeps {
  return {
    vaultRoot: '/tmp/vault',
    llm: {
      complete: vi.fn(async ({ role }: any) =>
        role === 'fanout' ? '["rag basics","rag pipeline"]' : '- compressed'
      ),
      stream: vi.fn()
    } as any,
    web: { dimension: 'web', api: 'tavily', run: vi.fn(async () => [
      { url: 'https://a.com', title: 'A', snippet: 's' }
    ]) },
    extract: vi.fn(async () => '# page\nbody'),
    store: makeRunStore(dir),
    now: () => new Date('2026-06-17T00:00:00Z'),
    ...over
  };
}

describe('startRun', () => {
  it('proposes web queries and pauses at awaiting_edit', async () => {
    const bus = makeEventBus();
    const deps = fakeDeps();
    const run = await startRun({ question: 'How does RAG work?', models: { fanout: 'f', synth: 's' } }, deps, bus);
    expect(run.status).toBe('awaiting_edit');
    expect(run.plan.dimensions[0].sources.map((s) => s.query)).toEqual(['rag basics', 'rag pipeline']);
    const saved = await deps.store.get(run.id);
    expect(saved?.status).toBe('awaiting_edit');
  });
});

describe('runPlan', () => {
  it('searches, compresses, synthesizes, and pauses at awaiting_deposit', async () => {
    const bus = makeEventBus();
    const deps = fakeDeps();
    const phases: string[] = [];
    const run0 = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    bus.subscribe(run0.id, (e) => phases.push(e.phase));

    // synth model returns a full report when role==='synth'
    (deps.llm.complete as any).mockImplementation(async ({ role }: any) =>
      role === 'synth' ? '# Q\n> answer\n## 核心发现\n- x [1] (置信度: 中)\n## 来源\n[1] A' : '- compressed'
    );

    const run = await runPlan(run0.id, run0.plan, deps, bus);
    expect(run.status).toBe('awaiting_deposit');
    expect(run.evidence).toHaveLength(1);
    expect(run.report?.markdown).toContain('核心发现');
    expect(run.depositPlan?.files.some((f) => f.kind === 'synthesis')).toBe(true);
    expect(phases).toContain('querying');
    expect(phases).toContain('awaiting_deposit');
  });

  it('skips disabled sources and survives an extractor failure', async () => {
    const bus = makeEventBus();
    const deps = fakeDeps({ extract: vi.fn(async () => '') }); // all extractions fail -> empty
    const run0 = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    run0.plan.dimensions[0].sources[1].enabled = false;
    const run = await runPlan(run0.id, run0.plan, deps, bus);
    expect(run.status).toBe('awaiting_deposit'); // did not crash
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/runs/machine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runs/machine.ts`**

`src/lib/server/runs/machine.ts`:
```ts
import type { MachineDeps } from './deps';
import type { EventBus } from '../events';
import type { Run, RunPlan, Evidence, PlanSource } from './types';
import { newRunId, slugify } from '../ids';
import { buildProposePrompt, parseProposedQueries } from '../pipeline/propose';
import { buildCompressPrompt } from '../pipeline/compress';
import { buildSynthesisPrompt } from '../pipeline/template';
import { buildDepositPlan } from '../vault/writer';
import { buildFrontmatter } from '../vault/frontmatter';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export async function startRun(
  input: { question: string; models: { fanout: string; synth: string } },
  deps: MachineDeps,
  bus: EventBus
): Promise<Run> {
  const id = newRunId();
  const run: Run = {
    id,
    createdAt: deps.now().toISOString(),
    status: 'proposing',
    question: input.question,
    models: input.models,
    plan: { dimensions: [] },
    evidence: []
  };
  await deps.store.save(run);
  bus.emit(id, { phase: 'proposing' });

  try {
    const raw = await deps.llm.complete({
      role: 'fanout',
      model: input.models.fanout,
      prompt: buildProposePrompt(input.question)
    });
    const queries = parseProposedQueries(raw);
    const sources: PlanSource[] = queries.map((q, i) => ({
      id: `web-${i + 1}`,
      api: 'tavily',
      query: q,
      enabled: true
    }));
    run.plan = { dimensions: [{ key: 'web', label: 'Web', enabled: true, sources }] };
    run.status = 'awaiting_edit';
    await deps.store.save(run);
    bus.emit(id, { phase: 'awaiting_edit', plan: run.plan });
    return run;
  } catch (err: any) {
    return fail(run, 'proposing', err, deps, bus);
  }
}

export async function runPlan(
  runId: string,
  editedPlan: RunPlan,
  deps: MachineDeps,
  bus: EventBus
): Promise<Run> {
  const run = await deps.store.get(runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  run.plan = editedPlan;
  run.status = 'searching';
  await deps.store.save(run);

  try {
    const evidence: Evidence[] = [];
    const sources = editedPlan.dimensions
      .filter((d) => d.enabled)
      .flatMap((d) => d.sources)
      .filter((s) => s.enabled);

    for (const src of sources) {
      bus.emit(runId, { phase: 'querying', sourceId: src.id, status: 'start' });
      try {
        const results = await deps.web.run(src.query);
        for (const r of results) {
          const md = await deps.extract(r.url);
          const compressed = await deps.llm.complete({
            role: 'fanout',
            model: run.models.fanout,
            prompt: buildCompressPrompt(run.question, r.title, md || r.snippet)
          });
          if (compressed.trim() === 'IRRELEVANT') continue;
          evidence.push({
            sourceId: src.id,
            url: r.url,
            title: r.title,
            compressed,
            retrievedAt: isoDate(deps.now())
          });
        }
        bus.emit(runId, { phase: 'querying', sourceId: src.id, status: 'ok', title: src.query });
      } catch {
        bus.emit(runId, { phase: 'querying', sourceId: src.id, status: 'fail', title: src.query });
      }
    }

    run.evidence = evidence;
    run.status = 'synthesizing';
    await deps.store.save(run);
    bus.emit(runId, { phase: 'synthesizing' });

    const markdown = await deps.llm.complete({
      role: 'synth',
      model: run.models.synth,
      prompt: buildSynthesisPrompt(run.question, evidence)
    });

    const date = isoDate(deps.now());
    const slug = slugify(run.question);
    const frontmatter = buildFrontmatter({
      title: run.question,
      date,
      tags: [],
      sources: evidence.map((e) => e.url),
      related: []
    });
    const depositPlan = buildDepositPlan({ slug, date, frontmatter, reportBody: markdown, evidence });

    run.report = { templateKey: 'smart-default', frontmatter, markdown };
    run.depositPlan = depositPlan;
    run.status = 'awaiting_deposit';
    await deps.store.save(run);
    bus.emit(runId, { phase: 'awaiting_deposit', files: depositPlan.files, markdown });
    return run;
  } catch (err: any) {
    return fail(run, 'synthesizing', err, deps, bus);
  }
}

async function fail(run: Run, stage: Run['status'], err: any, deps: MachineDeps, bus: EventBus): Promise<Run> {
  run.status = 'error';
  run.error = { stage, message: err?.message ?? String(err) };
  await deps.store.save(run);
  bus.emit(run.id, { phase: 'error', message: run.error.message });
  return run;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/runs/machine.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/runs/machine.ts src/lib/server/runs/machine.test.ts
git commit -m "feat: run orchestration machine (propose/search/compress/synthesize)"
```

### Task 6.4: Deposit step (`runs/deposit.ts`)

**Files:**
- Create: `src/lib/server/runs/deposit.ts`
- Test: `src/lib/server/runs/deposit.test.ts` (integration: temp git vault)

- [ ] **Step 1: Write the failing integration test**

`src/lib/server/runs/deposit.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { makeRunStore } from './store';
import { makeEventBus } from '../events';
import { depositRun } from './deposit';
import type { MachineDeps } from './deps';
import type { Run } from './types';

let vault: string, runsDir: string;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'vault-'));
  runsDir = await mkdtemp(join(tmpdir(), 'runs-'));
  const git = simpleGit(vault);
  await git.init();
  await git.addConfig('user.email', 't@t.co');
  await git.addConfig('user.name', 'T');
  await simpleGit(vault).raw(['commit', '--allow-empty', '-m', 'init']);
});
afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
  await rm(runsDir, { recursive: true, force: true });
});

function depositableRun(): Run {
  return {
    id: 'run-x', createdAt: '2026-06-17T00:00:00Z', status: 'awaiting_deposit',
    question: 'Q', models: { fanout: 'f', synth: 's' }, plan: { dimensions: [] }, evidence: [],
    report: { templateKey: 'smart-default', frontmatter: {} as any, markdown: '# Q' },
    depositPlan: {
      reportPath: 'wiki/synthesis/q.md',
      files: [
        { path: 'wiki/synthesis/q.md', kind: 'synthesis', contents: '---\ntype: synthesis\n---\n# Q' },
        { path: 'raw/research/2026-06-17-q/1-a.md', kind: 'raw', contents: '# A' }
      ]
    }
  };
}

function deps(): MachineDeps {
  return {
    vaultRoot: vault, llm: {} as any, web: {} as any, extract: vi.fn(),
    store: makeRunStore(runsDir), now: () => new Date('2026-06-17T00:00:00Z')
  };
}

describe('depositRun', () => {
  it('writes files, commits, and marks the run done', async () => {
    const d = deps();
    await d.store.save(depositableRun());
    const bus = makeEventBus();
    const run = await depositRun('run-x', d, bus);
    expect(run.status).toBe('done');
    const written = await readFile(join(vault, 'wiki/synthesis/q.md'), 'utf8');
    expect(written).toContain('# Q');
    const log = await simpleGit(vault).log();
    expect(log.latest?.message).toContain('research: Q');
  });

  it('hard-aborts when the vault is dirty at deposit time', async () => {
    const d = deps();
    await d.store.save(depositableRun());
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(vault, 'dirty.md'), 'x'); // make tree dirty
    const bus = makeEventBus();
    const run = await depositRun('run-x', d, bus);
    expect(run.status).toBe('error');
    expect(run.error?.message).toMatch(/dirty/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/runs/deposit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runs/deposit.ts`**

`src/lib/server/runs/deposit.ts`:
```ts
import type { MachineDeps } from './deps';
import type { EventBus } from '../events';
import type { Run } from './types';
import { assertCleanVault, autocommit } from '../vault/git';
import { writeDepositPlan } from '../vault/writer';

export async function depositRun(runId: string, deps: MachineDeps, bus: EventBus): Promise<Run> {
  const run = await deps.store.get(runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  if (!run.depositPlan) throw new Error('run has no deposit plan');

  run.status = 'depositing';
  await deps.store.save(run);

  try {
    await assertCleanVault(deps.vaultRoot); // hard-abort if dirty
    await writeDepositPlan(deps.vaultRoot, run.depositPlan);
    const sha = await autocommit(
      deps.vaultRoot,
      run.depositPlan.files.map((f) => f.path),
      `research: ${run.question}`
    );
    run.status = 'done';
    await deps.store.save(run);
    bus.emit(runId, { phase: 'done', reportPath: run.depositPlan.reportPath, sha });
    return run;
  } catch (err: any) {
    run.status = 'error';
    run.error = { stage: 'depositing', message: err?.message ?? String(err) };
    await deps.store.save(run);
    bus.emit(runId, { phase: 'error', message: run.error.message });
    return run;
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/runs/deposit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/runs/deposit.ts src/lib/server/runs/deposit.test.ts
git commit -m "feat: deposit step (dirty-guard + atomic write + autocommit)"
```

---

## Milestone 7 — API Routes & UI

### Task 7.1: Create-run route (`api/run/+server.ts`)

**Files:**
- Create: `src/routes/api/run/+server.ts`

- [ ] **Step 1: Implement the route**

`src/routes/api/run/+server.ts`:
```ts
import { json, error } from '@sveltejs/kit';
import { realDeps } from '$lib/server/runs/deps';
import { bus } from '$lib/server/events';
import { startRun } from '$lib/server/runs/machine';

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const question = (body.question ?? '').toString().trim();
  if (!question) throw error(400, 'question is required');
  const deps = realDeps();
  const models = {
    fanout: body.fanoutModel || deps.llm === deps.llm ? body.fanoutModel : undefined,
    synth: body.synthModel
  };
  // Default models come from config when the UI doesn't override.
  const run = await startRun(
    {
      question,
      models: {
        fanout: body.fanoutModel || (await import('$lib/server/config')).getConfig().llm.fanoutModel,
        synth: body.synthModel || (await import('$lib/server/config')).getConfig().llm.synthModel
      }
    },
    deps,
    bus
  );
  return json({ id: run.id, status: run.status, plan: run.plan });
}
```

> Simplify the models resolution if the above reads awkwardly: read `getConfig()` once at the top and use `body.fanoutModel ?? cfg.llm.fanoutModel`. Keep behavior identical.

- [ ] **Step 2: Clean up the route to the intended form**

Replace the body of `POST` with:
```ts
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const question = (body.question ?? '').toString().trim();
  if (!question) throw error(400, 'question is required');

  const { getConfig } = await import('$lib/server/config');
  const cfg = getConfig();
  const deps = realDeps();
  const run = await startRun(
    {
      question,
      models: {
        fanout: body.fanoutModel || cfg.llm.fanoutModel,
        synth: body.synthModel || cfg.llm.synthModel
      }
    },
    deps,
    bus
  );
  return json({ id: run.id, status: run.status, plan: run.plan });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/run/+server.ts
git commit -m "feat: POST /api/run (start + propose)"
```

### Task 7.2: SSE stream route (`api/run/[id]/stream/+server.ts`)

**Files:**
- Create: `src/routes/api/run/[id]/stream/+server.ts`

- [ ] **Step 1: Implement the SSE route**

`src/routes/api/run/[id]/stream/+server.ts`:
```ts
import { bus } from '$lib/server/events';
import type { RunEvent } from '$lib/server/events';

export async function GET({ params }) {
  const runId = params.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: RunEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));

      const unsub = bus.subscribe(runId, (e) => {
        send(e);
        if (e.phase === 'done' || e.phase === 'error') {
          clearInterval(hb);
          unsub();
          controller.close();
        }
      });

      const hb = setInterval(() => send({ phase: 'heartbeat' }), 15000);
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/api/run/[id]/stream/+server.ts
git commit -m "feat: GET /api/run/:id/stream (SSE + heartbeat)"
```

### Task 7.3: Plan + deposit routes

**Files:**
- Create: `src/routes/api/run/[id]/plan/+server.ts`
- Create: `src/routes/api/run/[id]/deposit/+server.ts`

- [ ] **Step 1: Implement the plan route**

`src/routes/api/run/[id]/plan/+server.ts`:
```ts
import { json, error } from '@sveltejs/kit';
import { realDeps } from '$lib/server/runs/deps';
import { bus } from '$lib/server/events';
import { runPlan } from '$lib/server/runs/machine';

export async function POST({ params, request }) {
  const body = await request.json().catch(() => ({}));
  if (!body.plan?.dimensions) throw error(400, 'plan.dimensions required');
  // Kick off async; the client watches progress over SSE.
  runPlan(params.id, body.plan, realDeps(), bus).catch(() => {});
  return json({ ok: true });
}
```

- [ ] **Step 2: Implement the deposit route**

`src/routes/api/run/[id]/deposit/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import { realDeps } from '$lib/server/runs/deps';
import { bus } from '$lib/server/events';
import { depositRun } from '$lib/server/runs/deposit';

export async function POST({ params }) {
  depositRun(params.id, realDeps(), bus).catch(() => {});
  return json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/run/[id]/plan/+server.ts src/routes/api/run/[id]/deposit/+server.ts
git commit -m "feat: POST plan (run) + deposit routes"
```

### Task 7.4: Single-page UI (`+page.svelte`)

**Files:**
- Create: `src/routes/+page.svelte`

- [ ] **Step 1: Implement the page**

`src/routes/+page.svelte`:
```svelte
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
    plan = plan;
  }
  function removeSource(i: number) {
    plan!.dimensions[0].sources.splice(i, 1);
    plan = plan;
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
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: single-page UI (ask -> edit plan -> progress -> deposit)"
```

---

## Milestone 8 — Full Test Pass, Smoke, Docs

### Task 8.1: Full unit suite green

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: ALL test files pass (config, ids, llm/client, llm/models, runs/store, search/tavily, search/jina, pipeline/propose, pipeline/compress, pipeline/template, vault/paths, vault/frontmatter, vault/writer, vault/git, events, runs/machine, runs/deposit).

- [ ] **Step 2: Typecheck**

Run: `npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors. Fix any type drift (especially that `Run`/`RunPlan`/`Evidence` shapes match across modules).

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "test: full suite green + typecheck clean"
```

### Task 8.2: Manual end-to-end smoke (real APIs, throwaway question)

- [ ] **Step 1: Prepare env**

```bash
cp .env.example .env
# edit .env: real VAULT_ROOT, LLM_API_KEY, TAVILY_API_KEY
```

- [ ] **Step 2: Ensure the vault is clean (deposit hard-aborts otherwise)**

Run: `git -C "$VAULT_ROOT" status --short`
Expected: empty output. If not, commit/stash vault changes first.

- [ ] **Step 3: Run the app and walk the flow**

Run: `npm run dev`, open `http://localhost:5173`, then:
1. Type a small question (e.g. "什么是 RAG").
2. Confirm 2-3 editable Tavily queries appear; edit one; disable one.
3. Click 按计划搜索; watch `querying`/`synthesizing` progress; a report preview renders.
4. Click 确认沉淀; confirm `✅ 已沉淀: wiki/synthesis/...`.

- [ ] **Step 4: Verify the deposit in the vault**

```bash
ls "$VAULT_ROOT/wiki/synthesis/" | tail -3
ls "$VAULT_ROOT/raw/research/" | tail -3
git -C "$VAULT_ROOT" log --oneline -1   # should read: research: 什么是 RAG
```
Expected: report file with correct frontmatter; raw snapshots present; one clean autocommit.

- [ ] **Step 5: Verify the dirty-abort guard**

Make the vault dirty (`echo x >> "$VAULT_ROOT/README.md"` or similar), run another deposit, and confirm the UI shows an `ERROR: ... dirty ...` and nothing is written. Then revert the dirty change.

### Task 8.3: README run instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the README**

`README.md`:
```markdown
# universal-search

Local research app: ask a question → edit the AI-proposed web-search plan → synthesize a report → deposit into your Obsidian vault.

## Setup
1. `npm install`
2. `cp .env.example .env` and fill in `VAULT_ROOT`, `LLM_API_KEY`, `TAVILY_API_KEY`.
3. `npm run dev` → http://localhost:5173

## Notes
- Provider-agnostic LLM: set `LLM_BASE_URL`/`LLM_API_KEY` (OpenAI default; DeepSeek = `https://api.deepseek.com`). Pick models in the UI.
- Deposits go to `wiki/synthesis/<slug>.md` + `raw/research/<date>-<slug>/`, then git-autocommit.
- Deposit **hard-aborts if the vault git tree is dirty** at run start.

## Test
`npm test`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README run + setup instructions"
```

---

## Self-Review

**1. Spec coverage:**
- §3 paradigm steps 1-5 → Tasks 6.3 (propose/edit/search/synthesize) + 6.4 (deposit) + 7.x (routes/UI). ✅ (Step 6 "save as workflow" is explicitly v3, out of scope.)
- §5.1 stack (SvelteKit/AI SDK/Tavily/Jina/SSE/JSON/Vitest/simple-git) → M0-M7. ✅
- §5.2 provider-agnostic + model selection → Tasks 1.2, 1.3, UI selectors. ✅
- §5.3 run state machine + atomic JSON → Tasks 2.2, 6.3. ✅
- §5.4 endpoints → Tasks 7.1-7.3. ✅
- §5.6 SSE events → Tasks 6.1, 7.2. ✅
- §6 SourceRunner adapter → Task 3.1. ✅
- §7 deposit safety (slugify/path-assert/atomic/plan-confirm/autocommit/dirty-abort, synthesis+raw only) → Tasks 1.1, 5.1-5.4, 6.4. ✅
- §8 default template → Task 4.3. ✅
- §11 graceful degrade (source failure, budget cap) → Tasks 3.3, 4.2, 6.3. ✅
- §12 testing → unit tests throughout + Task 8.2 smoke + 8.1 dry coverage. ✅
- §15 decisions (default models via env+UI; tags by strong model; related[] blank in v1) → models default in 7.1; `tags: []` placeholder in machine (note below); `related: []` in machine. ⚠️ Gap: §15 says "tags by strong model (3-7, reuse vault vocab)" but machine currently passes `tags: []`. See fix below.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" left. The two "verify against current docs" notes (AI SDK provider factory, Tavily auth) are concrete fallbacks, not logic placeholders.

**3. Type consistency:** `Run`/`RunPlan`/`PlanSource`/`Evidence`/`DepositFile`/`Frontmatter` defined once (Tasks 2.1, 5.2) and imported everywhere. `makeLlm().complete({role, model, prompt})` signature consistent across machine usages. `bus.emit/subscribe(runId, RunEvent)` consistent across events/machine/routes. SSE `RunEvent` union matches what `+page.svelte` switches on.

### Gap fix — Task 4.4: tags by strong model (closes §15 decision)

**Files:**
- Create: `src/lib/server/pipeline/tags.ts`
- Test: `src/lib/server/pipeline/tags.test.ts`
- Modify: `src/lib/server/runs/machine.ts` (call it before `buildFrontmatter`)

- [ ] **Step 1: Write the failing test**

`src/lib/server/pipeline/tags.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildTagsPrompt, parseTags } from './tags';

describe('tags', () => {
  it('prompt asks for 3-7 tags and includes the question', () => {
    const p = buildTagsPrompt('什么是 RAG', ['AI', 'LLM']);
    expect(p).toContain('什么是 RAG');
    expect(p).toContain('AI');
  });
  it('parseTags reads a JSON array and clamps to 3-7', () => {
    expect(parseTags('["a","b","c","d"]')).toEqual(['a', 'b', 'c', 'd']);
    expect(parseTags('["a","b","c","d","e","f","g","h","i"]').length).toBe(7);
  });
  it('parseTags returns [] when unparseable (frontmatter tags stay empty)', () => {
    expect(parseTags('nope')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/server/pipeline/tags.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pipeline/tags.ts`**

`src/lib/server/pipeline/tags.ts`:
```ts
export function buildTagsPrompt(question: string, vocab: string[]): string {
  return [
    'Produce 3-7 short topical tags for a research note.',
    'Prefer reusing tags from this existing vocabulary when they fit:',
    vocab.slice(0, 60).join(', ') || '(none)',
    'Output ONLY a JSON array of tag strings.',
    '',
    `Question: ${question}`
  ].join('\n');
}

export function parseTags(raw: string): string[] {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 7);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/server/pipeline/tags.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into the machine**

In `src/lib/server/runs/machine.ts`, add imports near the top:
```ts
import { buildTagsPrompt, parseTags } from '../pipeline/tags';
```
Then in `runPlan`, replace the `buildFrontmatter({... tags: [], ...})` call with:
```ts
let tags: string[] = [];
try {
  const tagRaw = await deps.llm.complete({
    role: 'synth',
    model: run.models.synth,
    prompt: buildTagsPrompt(run.question, [])
  });
  tags = parseTags(tagRaw);
} catch {
  tags = [];
}
const frontmatter = buildFrontmatter({
  title: run.question,
  date,
  tags,
  sources: evidence.map((e) => e.url),
  related: []
});
```

- [ ] **Step 6: Update the machine test for the new call**

In `src/lib/server/runs/machine.test.ts`, the existing synth mock returns a report for `role==='synth'`. Make the tags call tolerant by having that mock return a JSON array when the prompt contains 'tags'. Update the `mockImplementation` in the "searches, compresses, synthesizes" test:
```ts
(deps.llm.complete as any).mockImplementation(async ({ role, prompt }: any) => {
  if (role === 'synth' && /tags/i.test(prompt)) return '["RAG","AI"]';
  if (role === 'synth') return '# Q\n> answer\n## 核心发现\n- x [1] (置信度: 中)\n## 来源\n[1] A';
  return '- compressed';
});
```
Then add an assertion: `expect(run.report?.frontmatter.tags).toEqual(['RAG', 'AI']);`

- [ ] **Step 7: Run machine + tags tests**

Run: `npx vitest run src/lib/server/runs/machine.test.ts src/lib/server/pipeline/tags.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/pipeline/tags.ts src/lib/server/pipeline/tags.test.ts src/lib/server/runs/machine.ts src/lib/server/runs/machine.test.ts
git commit -m "feat: strong-model tag generation wired into deposit frontmatter"
```

---

## Done Criteria

- `npm test` green across all modules; `svelte-check` clean.
- Manual smoke (Task 8.2) deposits a real report into the vault with correct frontmatter + raw snapshots + one clean autocommit, and the dirty-vault guard aborts safely.
- The flow proves the v1 paradigm: **editable plan → cheap-model fanout → strong-model synthesis → SSE progress → schema-respecting safe deposit**. v2 (more dimensions) and v3 (saved workflows) build on these seams without rework.
