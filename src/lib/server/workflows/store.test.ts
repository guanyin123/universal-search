import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveWorkflow, listWorkflows, loadWorkflow, deleteWorkflow, WORKFLOWS_DIR } from './store';
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
  // Public branch: a plain directory — NOT a git repo.
  vault = await mkdtemp(join(tmpdir(), 'save-'));
});
afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

describe('saveWorkflow', () => {
  it('atomically writes into .research-workflows/ (plain file, no git)', async () => {
    const { path } = await saveWorkflow(vault, sampleDoc());
    expect(path).toBe(`${WORKFLOWS_DIR}/wf-rag.md`);
    const onDisk = await readFile(join(vault, path), 'utf8');
    expect(onDisk).toContain('id: wf-rag');
  });

  it('rejects when no save directory is configured', async () => {
    await expect(saveWorkflow('', sampleDoc())).rejects.toThrow(/保存目录/);
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

describe('deleteWorkflow', () => {
  it('removes a saved workflow by slug so it no longer lists', async () => {
    await saveWorkflow(vault, sampleDoc());
    await saveWorkflow(vault, sampleDoc({ id: 'wf-other', name: 'Other' }));

    expect(await deleteWorkflow(vault, 'wf-rag')).toBe(true);
    expect((await listWorkflows(vault)).map((w) => w.slug)).toEqual(['wf-other']);
    expect(await loadWorkflow(vault, 'wf-rag')).toBeNull();
  });

  it('deletes by id via scan when the slug path differs', async () => {
    await saveWorkflow(vault, sampleDoc({ id: 'wf-other', name: 'Other' }));
    expect(await deleteWorkflow(vault, 'wf-other')).toBe(true);
    expect(await listWorkflows(vault)).toEqual([]);
  });

  it('returns false when nothing matches (no throw)', async () => {
    await saveWorkflow(vault, sampleDoc());
    expect(await deleteWorkflow(vault, 'nope')).toBe(false);
    expect((await listWorkflows(vault)).map((w) => w.slug)).toEqual(['wf-rag']);
  });

  it('rejects when no save directory is configured', async () => {
    await expect(deleteWorkflow('', 'wf-rag')).rejects.toThrow(/保存目录/);
  });
});
