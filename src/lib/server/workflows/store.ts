import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { slugify } from '../ids';
import { resolveInsideVault } from '../vault/paths';
import { writeDepositPlan } from '../vault/writer';
import { assertCleanVault, autocommit } from '../vault/git';
import { serializeWorkflowDoc, parseWorkflowDoc } from './serialize';
import type { WorkflowDoc, WorkflowSummary } from './types';

/** The single new vault write-area v3 introduces (git-tracked, Obsidian-hidden dotfolder). */
export const WORKFLOWS_DIR = '.research-workflows';

function relPathFor(slug: string): string {
  return `${WORKFLOWS_DIR}/${slug}.md`;
}

/** Slug used for the on-disk filename — derived from the workflow id (or name). */
export function workflowSlug(doc: WorkflowDoc): string {
  return slugify(doc.id || doc.name);
}

/**
 * Atomically write a workflow doc into `.research-workflows/<slug>.md`, reusing the
 * existing vault writer (resolveInsideVault path assertion + temp→rename atomic write).
 * Returns the vault-relative path. Does NOT touch git — see saveWorkflow for the guarded path.
 */
export async function writeWorkflowFile(vaultRoot: string, doc: WorkflowDoc): Promise<string> {
  // resolveInsideVault is invoked inside writeDepositPlan; assert here too for an early, clear failure.
  const path = relPathFor(workflowSlug(doc));
  resolveInsideVault(vaultRoot, path);
  await writeDepositPlan(vaultRoot, {
    reportPath: path,
    files: [{ path, kind: 'workflow', contents: serializeWorkflowDoc(doc) }]
  });
  return path;
}

/**
 * Save a workflow through the full vault safety chain: hard-abort on a dirty vault,
 * atomic write, then autocommit just that one file. Mirrors depositRun's guarantees,
 * widened only to the `.research-workflows/` area.
 */
export async function saveWorkflow(vaultRoot: string, doc: WorkflowDoc): Promise<{ path: string; sha: string }> {
  await assertCleanVault(vaultRoot); // never co-mingle with the user's uncommitted vault edits
  const path = await writeWorkflowFile(vaultRoot, doc);
  const sha = await autocommit(vaultRoot, [path], `workflow: save ${doc.name}`);
  return { path, sha };
}

/**
 * List parseable workflows under `.research-workflows/`. A missing dir → []; an
 * unparseable file is skipped (graceful degrade — one bad file never breaks the picker).
 */
export async function listWorkflows(vaultRoot: string): Promise<WorkflowSummary[]> {
  const dir = join(vaultRoot, WORKFLOWS_DIR);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.md'));
  } catch {
    return [];
  }
  const out: WorkflowSummary[] = [];
  for (const n of names.sort()) {
    try {
      const doc = parseWorkflowDoc(await readFile(join(dir, n), 'utf8'));
      if (!doc) continue;
      out.push({
        slug: n.replace(/\.md$/, ''),
        id: doc.id,
        name: doc.name,
        mode: doc.mode ?? 'report',
        archetype: doc.archetype,
        questionPattern: doc.questionPattern
      });
    } catch {
      // unreadable file — skip
    }
  }
  return out;
}

/** Load a full workflow by its file slug, falling back to a scan-by-id. Null if absent/unparseable. */
export async function loadWorkflow(vaultRoot: string, slugOrId: string): Promise<WorkflowDoc | null> {
  const direct = join(vaultRoot, relPathFor(slugify(slugOrId)));
  try {
    const doc = parseWorkflowDoc(await readFile(direct, 'utf8'));
    if (doc) return doc;
  } catch {
    // fall through to scan
  }
  const dir = join(vaultRoot, WORKFLOWS_DIR);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.md'));
  } catch {
    return null;
  }
  for (const n of names) {
    try {
      const doc = parseWorkflowDoc(await readFile(join(dir, n), 'utf8'));
      if (doc && (doc.id === slugOrId || n.replace(/\.md$/, '') === slugOrId)) return doc;
    } catch {
      // skip
    }
  }
  return null;
}
