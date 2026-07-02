import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRunStore } from './store';
import { makeEventBus } from '../events';
import { depositRun } from './deposit';
import type { MachineDeps } from './deps';
import type { Run } from './types';

let saveRoot: string, runsDir: string;
beforeEach(async () => {
  // Public branch: a plain directory — NOT a git repo.
  saveRoot = await mkdtemp(join(tmpdir(), 'save-'));
  runsDir = await mkdtemp(join(tmpdir(), 'runs-'));
});
afterEach(async () => {
  await rm(saveRoot, { recursive: true, force: true });
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

function deps(over: Partial<MachineDeps> = {}): MachineDeps {
  return {
    vaultRoot: saveRoot, llm: {} as any, runners: {} as any, extract: vi.fn(),
    readLibrary: vi.fn(async () => ({ vocab: [], notes: [] })),
    store: makeRunStore(runsDir), now: () => new Date('2026-06-17T00:00:00Z'),
    ...over
  };
}

describe('depositRun', () => {
  it('writes files into a plain (non-git) directory and marks the run done', async () => {
    const d = deps();
    await d.store.save(depositableRun());
    const bus = makeEventBus();
    const run = await depositRun('run-x', d, bus);
    expect(run.status).toBe('done');
    const written = await readFile(join(saveRoot, 'wiki/synthesis/q.md'), 'utf8');
    expect(written).toContain('# Q');
    const raw = await readFile(join(saveRoot, 'raw/research/2026-06-17-q/1-a.md'), 'utf8');
    expect(raw).toContain('# A');
  });

  it('emits the report path on done', async () => {
    const d = deps();
    await d.store.save(depositableRun());
    const bus = makeEventBus();
    const events: any[] = [];
    bus.subscribe('run-x', (e) => events.push(e));
    await depositRun('run-x', d, bus);
    expect(events.at(-1)).toMatchObject({ phase: 'done', reportPath: 'wiki/synthesis/q.md' });
  });

  it('rejects when no save directory is configured', async () => {
    const d = deps({ vaultRoot: '' });
    await d.store.save(depositableRun());
    const bus = makeEventBus();
    await expect(depositRun('run-x', d, bus)).rejects.toThrow(/保存目录/);
  });
});
