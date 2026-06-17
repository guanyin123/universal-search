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
  it('searches, compresses, synthesizes, tags, and pauses at awaiting_deposit', async () => {
    const bus = makeEventBus();
    const deps = fakeDeps();
    const phases: string[] = [];
    const run0 = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    bus.subscribe(run0.id, (e) => phases.push(e.phase));

    (deps.llm.complete as any).mockImplementation(async ({ role, prompt }: any) => {
      if (role === 'synth' && /tags/i.test(prompt)) return '["RAG","AI"]';
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
      web: {
        dimension: 'web',
        api: 'tavily',
        run: vi.fn(async () => [{ url: 'https://dup.com', title: 'D', snippet: 's' }])
      } as any
    });
    // startRun proposes 2 sources; both return the SAME url → only one should be extracted
    const run0 = await startRun({ question: 'Q', models: { fanout: 'f', synth: 's' } }, deps, bus);
    const run = await runPlan(run0.id, run0.plan, deps, bus);
    expect(run.evidence).toHaveLength(1);
    expect(extract).toHaveBeenCalledTimes(1);
  });
});
