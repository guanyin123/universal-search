import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRunStore } from './store';
import { makeEventBus } from '../events';
import { hydrateReplay, replayWorkflow } from './machine';
import type { MachineDeps } from './deps';
import type { WorkflowDoc } from '../workflows/types';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'replay-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function workflow(over: Partial<WorkflowDoc> = {}): WorkflowDoc {
  return {
    id: 'wf-x',
    name: 'X',
    version: 1,
    mode: 'report',
    archetype: 'smart-default',
    questionPattern: 'orig pattern',
    dimensions: [{ key: 'web', label: 'Web' }],
    sources: [
      { dimension: 'web', api: 'tavily', query: '{{question}} overview' },
      { dimension: 'web', api: 'tavily', query: 'rag benchmarks' }
    ],
    deposit: { reportDir: 'wiki/synthesis', rawDir: 'raw/research' },
    modelConfig: { fanout: 'wf-fanout', synth: 'wf-synth' },
    runHistory: [{ id: 'run-1', date: '2026-06-24', question: 'orig' }],
    templateSections: ['## 核心发现'],
    synthesisPrompt: 'WORKFLOW-SPECIFIC-PROMPT be careful',
    ...over
  };
}

function fakeDeps(over: Partial<MachineDeps> = {}, queries: string[] = []): MachineDeps {
  return {
    vaultRoot: '/tmp/vault',
    llm: {
      complete: vi.fn(async ({ role }: any) => (role === 'fanout' ? '["x"]' : '# Q\n> a\n## 来源\n[1]')),
      stream: vi.fn()
    } as any,
    runners: {
      web: {
        dimension: 'web',
        api: 'tavily',
        run: vi.fn(async (q: string) => {
          queries.push(q);
          return [{ url: `https://a.com/${queries.length}`, title: 'A', snippet: 's' }];
        })
      }
    },
    extract: vi.fn(async () => '# page\nbody'),
    readLibrary: vi.fn(async () => ({ vocab: [], notes: [] })),
    store: makeRunStore(dir),
    now: () => new Date('2026-06-24T00:00:00Z'),
    ...over
  };
}

describe('hydrateReplay', () => {
  it('skips proposing: lands directly at searching with the hydrated plan', async () => {
    const deps = fakeDeps();
    const run = await hydrateReplay(workflow(), { question: 'NEWQ' }, deps);
    expect(run.status).toBe('searching');
    // queries bound to the new question; keyword query verbatim
    expect(run.plan.dimensions[0].sources.map((s) => s.query)).toEqual(['NEWQ overview', 'rag benchmarks']);
    // proposing model was never asked
    expect(deps.llm.complete).not.toHaveBeenCalled();
    // run persisted so runPlan can pick it up
    expect((await deps.store.get(run.id))?.status).toBe('searching');
  });

  it('defaults models to the workflow config, but lets the caller override', async () => {
    const deps = fakeDeps();
    const a = await hydrateReplay(workflow(), { question: 'Q' }, deps);
    expect(a.models).toEqual({ fanout: 'wf-fanout', synth: 'wf-synth' });
    const b = await hydrateReplay(workflow(), { question: 'Q', models: { fanout: 'o', synth: 'p' } }, deps);
    expect(b.models).toEqual({ fanout: 'o', synth: 'p' });
  });

  it('parks at awaiting_edit (no auto-search) when asked, with the plan pre-filled', async () => {
    const deps = fakeDeps();
    const run = await hydrateReplay(workflow(), { question: 'NEWQ' }, deps, { status: 'awaiting_edit' });
    expect(run.status).toBe('awaiting_edit');
    expect(run.plan.dimensions[0].sources.map((s) => s.query)).toEqual(['NEWQ overview', 'rag benchmarks']);
    expect(deps.llm.complete).not.toHaveBeenCalled();
    // persisted so the editor's 开始搜索 (→ /plan) can pick it up
    expect((await deps.store.get(run.id))?.status).toBe('awaiting_edit');
  });
});

describe('replayWorkflow', () => {
  it('reuses the runPlan chain and synthesizes with the workflow’s own prompt', async () => {
    const queries: string[] = [];
    const deps = fakeDeps({}, queries);
    let synthPrompt = '';
    (deps.llm.complete as any).mockImplementation(async ({ role, prompt }: any) => {
      if (/tags/i.test(prompt)) return '["T"]';
      if (role === 'synth') {
        synthPrompt = prompt;
        return '# NEWQ\n> a\n## 来源\n[1]';
      }
      return '- compressed';
    });
    const bus = makeEventBus();
    const run = await replayWorkflow(workflow(), { question: 'NEWQ' }, deps, bus);

    expect(run.status).toBe('awaiting_deposit');
    expect(run.evidence.length).toBeGreaterThan(0);
    // the search used the hydrated queries
    expect(queries).toEqual(['NEWQ overview', 'rag benchmarks']);
    // synthesis used the workflow's own prompt + the new question
    expect(synthPrompt).toContain('WORKFLOW-SPECIFIC-PROMPT');
    expect(synthPrompt).toContain('NEWQ');
  });

  it('dispatches a github-mode workflow to the ranked-repos tail (not runPlan)', async () => {
    const gh = workflow({
      mode: 'github',
      dimensions: [{ key: 'github', label: 'GitHub' }],
      sources: [{ dimension: 'github', api: 'github', query: '{{question}} cli' }]
    });
    const deps = fakeDeps({
      runners: {
        github: {
          dimension: 'github',
          api: 'github',
          run: vi.fn(async () => [
            { url: 'https://github.com/o/a', title: 'o/a', snippet: 'd', stars: 900 }
          ])
        }
      } as any,
      // synth model returns reputation judgments
      llm: {
        complete: vi.fn(async () => '[{"name":"o/a","reputation":8,"reason":"solid"}]'),
        stream: vi.fn()
      } as any
    });
    const bus = makeEventBus();
    const run = await replayWorkflow(gh, { question: 'a cli tool' }, deps, bus);
    expect(run.status).toBe('done');
    expect(run.mode).toBe('github');
    expect(run.repos?.[0].fullName).toBe('o/a');
    expect(run.evidence).toHaveLength(0); // github tail never builds evidence
  });
});
