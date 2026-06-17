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
    await writeFile(join(vault, 'dirty.md'), 'x');
    const bus = makeEventBus();
    const run = await depositRun('run-x', d, bus);
    expect(run.status).toBe('error');
    expect(run.error?.message).toMatch(/dirty/i);
  });
});
