import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { saveWorkflow, listWorkflows, loadWorkflow, WORKFLOWS_DIR } from './store';
import type { WorkflowDoc } from './types';

function sampleDoc(over: Partial<WorkflowDoc> = {}): WorkflowDoc {
  return {
    id: 'wf-rag',
    name: 'RAG 调研',
    version: 1,
    mode: 'report',
    archetype: 'smart-default',
    questionPattern: 'How does RAG work?',
    dimensions: [{ key: 'web', label: 'Web' }],
    sources: [{ dimension: 'web', api: 'tavily', query: '{{question}} overview' }],
    deposit: { reportDir: 'wiki/synthesis', rawDir: 'raw/research' },
    modelConfig: { fanout: 'f', synth: 's' },
    runHistory: [{ id: 'run-1', date: '2026-06-24', question: 'How does RAG work?' }],
    templateSections: ['## 核心发现'],
    synthesisPrompt: 'be careful',
    ...over
  };
}

let vault: string;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'vault-'));
  const git = simpleGit(vault);
  await git.init();
  await git.addConfig('user.email', 't@t.co');
  await git.addConfig('user.name', 'T');
  await git.raw(['commit', '--allow-empty', '-m', 'init']);
});
afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

describe('saveWorkflow', () => {
  it('atomically writes into .research-workflows/ and autocommits', async () => {
    const { path, sha } = await saveWorkflow(vault, sampleDoc());
    expect(path).toBe(`${WORKFLOWS_DIR}/wf-rag.md`);
    expect(sha).toMatch(/^[0-9a-f]{7,}$/);
    const onDisk = await readFile(join(vault, path), 'utf8');
    expect(onDisk).toContain('id: wf-rag');
    const log = await simpleGit(vault).log();
    expect(log.latest?.message).toContain('workflow: save RAG 调研');
    // vault is clean again (the write was committed)
    expect((await simpleGit(vault).status()).isClean()).toBe(true);
  });

  it('hard-aborts when the vault is dirty (never co-mingles)', async () => {
    await writeFile(join(vault, 'dirty.md'), 'x');
    await expect(saveWorkflow(vault, sampleDoc())).rejects.toThrow(/dirty/i);
  });
});

describe('listWorkflows / loadWorkflow', () => {
  it('lists saved workflows and loads them by slug and by id', async () => {
    await saveWorkflow(vault, sampleDoc());
    await saveWorkflow(vault, sampleDoc({ id: 'wf-other', name: 'Other' }));

    const list = await listWorkflows(vault);
    expect(list.map((w) => w.slug).sort()).toEqual(['wf-other', 'wf-rag']);

    const bySlug = await loadWorkflow(vault, 'wf-rag');
    expect(bySlug?.name).toBe('RAG 调研');
    const byId = await loadWorkflow(vault, 'wf-other');
    expect(byId?.name).toBe('Other');
  });

  it('returns [] / null when nothing is saved', async () => {
    expect(await listWorkflows(vault)).toEqual([]);
    expect(await loadWorkflow(vault, 'nope')).toBeNull();
  });

  it('skips an unparseable file instead of crashing the listing', async () => {
    await saveWorkflow(vault, sampleDoc());
    await mkdir(join(vault, WORKFLOWS_DIR), { recursive: true });
    await writeFile(join(vault, WORKFLOWS_DIR, 'broken.md'), 'not a workflow at all');
    const list = await listWorkflows(vault);
    expect(list.map((w) => w.slug)).toEqual(['wf-rag']);
  });
});
