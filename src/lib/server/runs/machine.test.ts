import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRunStore } from './store';
import { makeEventBus } from '../events';
import { startRun, runPlan } from './machine';
import type { MachineDeps } from './deps';

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
    runners: {
      web: {
        dimension: 'web',
        api: 'tavily',
        run: vi.fn(async () => [{ url: 'https://a.com', title: 'A', snippet: 's' }])
      }
    },
    extract: vi.fn(async () => '# page\nbody'),
    readLibrary: vi.fn(async () => ({ vocab: [], notes: [] })),
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

  it('skips a dimension whose proposing fails but keeps the others (an Exa hiccup never drops Web)', async () => {
    const bus = makeEventBus();
    const deps = fakeDeps({
      runners: {
        web: { dimension: 'web', api: 'tavily', run: vi.fn(async () => [{ url: 'https://a.com', title: 'A', snippet: 's' }]) },
        peoples_writing: { dimension: 'peoples_writing', api: 'exa', run: vi.fn(async () => []) }
      } as any
    });
    // The peoples_writing prompt is the only one mentioning long-form/essays/blog — make it throw.
    (deps.llm.complete as any).mockImplementation(async ({ prompt }: any) => {
      if (/long-form|essays|blog|personal/i.test(prompt)) throw new Error('exa planning down');
      return '["rag basics","rag pipeline"]';
    });
    const run = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    expect(run.status).toBe('awaiting_edit');
    expect(run.plan.dimensions.map((d) => d.key)).toEqual(['web']);
  });

  it('aborts at the proposing stage when every dimension fails to yield queries', async () => {
    const bus = makeEventBus();
    const deps = fakeDeps();
    (deps.llm.complete as any).mockImplementation(async ({ role }: any) => {
      if (role === 'fanout') throw new Error('planning down');
      return '- compressed';
    });
    const run = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    expect(run.status).toBe('error');
    expect(run.error?.stage).toBe('proposing');
    expect(run.error?.message).toContain('未能为任何维度生成搜索查询');
  });
});

describe('runPlan', () => {
  it('searches, compresses, synthesizes, tags, and pauses at awaiting_deposit', async () => {
    const bus = makeEventBus();
    const deps = fakeDeps();
    const phases: string[] = [];
    const run0 = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    bus.subscribe(run0.id, (e) => phases.push(e.phase));

    (deps.llm.complete as any).mockImplementation(async ({ role, prompt }: any) => {
      if (/tags/i.test(prompt)) return '["RAG","AI"]';
      if (role === 'synth') return '# Q\n> answer\n## 核心发现\n- x [1] (置信度: 中)\n## 来源\n[1] A';
      return '- compressed';
    });

    const run = await runPlan(run0.id, run0.plan, deps, bus);
    expect(run.status).toBe('awaiting_deposit');
    expect(run.evidence).toHaveLength(1);
    expect(run.report?.markdown).toContain('核心发现');
    expect(run.report?.frontmatter.tags).toEqual(['RAG', 'AI']);
    expect(run.depositPlan?.files.some((f) => f.kind === 'synthesis')).toBe(true);
    expect(phases).toContain('querying');
    expect(phases).toContain('awaiting_deposit');
  });

  it('skips disabled sources and survives an extractor failure', async () => {
    const bus = makeEventBus();
    const deps = fakeDeps({ extract: vi.fn(async () => '') });
    const run0 = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    run0.plan.dimensions[0].sources[1].enabled = false;
    const run = await runPlan(run0.id, run0.plan, deps, bus);
    expect(run.status).toBe('awaiting_deposit');
  });

  it('dedups the same URL across sources before extracting (no double extract/compress)', async () => {
    const bus = makeEventBus();
    const extract = vi.fn(async () => '# page');
    const deps = fakeDeps({
      extract,
      runners: {
        web: {
          dimension: 'web',
          api: 'tavily',
          run: vi.fn(async () => [{ url: 'https://dup.com', title: 'D', snippet: 's' }])
        }
      } as any
    });
    // startRun proposes 2 sources; both return the SAME url → only one should be extracted
    const run0 = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    const run = await runPlan(run0.id, run0.plan, deps, bus);
    expect(run.evidence).toHaveLength(1);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('aborts with an error when every source fails (never synthesizes empty evidence)', async () => {
    const bus = makeEventBus();
    const deps = fakeDeps({
      runners: {
        web: {
          dimension: 'web',
          api: 'tavily',
          run: vi.fn(async () => {
            throw new Error('search down');
          })
        }
      } as any
    });
    const run0 = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    const run = await runPlan(run0.id, run0.plan, deps, bus);
    expect(run.status).toBe('error');
    expect(run.evidence).toHaveLength(0);
  });

  it('dispatches each dimension to its own runner and tags evidence with the dimension', async () => {
    const bus = makeEventBus();
    const webRun = vi.fn(async () => [{ url: 'https://web.com', title: 'W', snippet: 's' }]);
    const exaRun = vi.fn(async () => [{ url: 'https://essay.com', title: 'E', snippet: 's' }]);
    const deps = fakeDeps({
      runners: {
        web: { dimension: 'web', api: 'tavily', run: webRun },
        peoples_writing: { dimension: 'peoples_writing', api: 'exa', run: exaRun }
      } as any
    });
    const run0 = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    // startRun proposes for every configured dimension, in order
    expect(run0.plan.dimensions.map((d) => d.key)).toEqual(['web', 'peoples_writing']);

    (deps.llm.complete as any).mockImplementation(async ({ role, prompt }: any) => {
      if (/tags/i.test(prompt)) return '["T"]';
      if (role === 'synth') return '# Q\n> a\n## 来源\n[1]';
      return '- compressed';
    });

    const run = await runPlan(run0.id, run0.plan, deps, bus);
    expect(webRun).toHaveBeenCalled();
    expect(exaRun).toHaveBeenCalled();
    expect(run.evidence).toHaveLength(2);
    expect(run.evidence.map((e) => e.dimension).sort()).toEqual(['peoples_writing', 'web']);
  });

  it('isolates a failing dimension: peoples_writing down, web still produces evidence', async () => {
    const bus = makeEventBus();
    const webRun = vi.fn(async () => [{ url: 'https://web.com', title: 'W', snippet: 's' }]);
    const exaRun = vi.fn(async () => {
      throw new Error('exa down');
    });
    const deps = fakeDeps({
      runners: {
        web: { dimension: 'web', api: 'tavily', run: webRun },
        peoples_writing: { dimension: 'peoples_writing', api: 'exa', run: exaRun }
      } as any
    });
    const run0 = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    const run = await runPlan(run0.id, run0.plan, deps, bus);
    expect(exaRun).toHaveBeenCalled();
    expect(run.status).toBe('awaiting_deposit');
    expect(run.evidence).toHaveLength(1);
    expect(run.evidence.map((e) => e.dimension)).toEqual(['web']);
  });

  it('dedups the same URL across dimensions before extracting (web + peoples_writing share a page)', async () => {
    const bus = makeEventBus();
    const extract = vi.fn(async () => '# page');
    const url = 'https://shared-essay.com';
    const deps = fakeDeps({
      extract,
      runners: {
        web: { dimension: 'web', api: 'tavily', run: vi.fn(async () => [{ url, title: 'S', snippet: 's' }]) },
        peoples_writing: { dimension: 'peoples_writing', api: 'exa', run: vi.fn(async () => [{ url, title: 'S', snippet: 's' }]) }
      } as any
    });
    const run0 = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    const run = await runPlan(run0.id, run0.plan, deps, bus);
    expect(run.evidence).toHaveLength(1);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('biases tags toward the vault vocabulary and auto-links related notes by tag overlap', async () => {
    const bus = makeEventBus();
    const library = {
      vocab: ['RAG', 'AI', '检索'],
      notes: [
        { path: 'wiki/synthesis/rag-basics.md', title: 'RAG Basics', tags: ['RAG', 'AI'] },
        { path: 'wiki/synthesis/cooking.md', title: 'Cooking', tags: ['food'] }
      ]
    };
    const deps = fakeDeps({ readLibrary: vi.fn(async () => library) });
    const run0 = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);

    let tagsPrompt = '';
    (deps.llm.complete as any).mockImplementation(async ({ role, prompt }: any) => {
      if (/topical tags/i.test(prompt)) {
        tagsPrompt = prompt;
        return '["RAG","AI"]';
      }
      if (role === 'synth') return '# Q\n> a\n## 来源\n[1]';
      return '- compressed';
    });

    const run = await runPlan(run0.id, run0.plan, deps, bus);
    expect(deps.readLibrary).toHaveBeenCalled();
    // the existing vocabulary was offered to the tag generator
    expect(tagsPrompt).toContain('RAG');
    // related auto-linked to the tag-overlapping note only (not the unrelated one, not self)
    expect(run.report?.frontmatter.related).toEqual(['wiki/synthesis/rag-basics.md']);
  });

  it('gracefully degrades an enabled dimension whose runner is missing (no crash)', async () => {
    const bus = makeEventBus();
    const deps = fakeDeps(); // only the web runner is configured
    const run0 = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    // Simulate a resumed/hand-edited plan that enables peoples_writing with no runner available
    // (e.g. EXA_API_KEY removed between propose and run).
    run0.plan.dimensions.push({
      key: 'peoples_writing',
      label: '他人写作',
      enabled: true,
      sources: [{ id: 'peoples_writing-1', api: 'exa', query: 'essays', enabled: true }]
    });
    const events: any[] = [];
    bus.subscribe(run0.id, (e) => events.push(e));
    const run = await runPlan(run0.id, run0.plan, deps, bus);
    expect(run.status).toBe('awaiting_deposit');
    expect(run.evidence.every((e) => e.dimension === 'web')).toBe(true);
    expect(
      events.some((e) => e.phase === 'querying' && e.status === 'fail' && e.sourceId === 'peoples_writing-1')
    ).toBe(true);
  });
});
