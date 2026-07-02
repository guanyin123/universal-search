import { readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { slugify } from '../ids';
import { resolveInsideVault } from '../vault/paths';
import { writeDepositPlan } from '../vault/writer';
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
 * Save a workflow into `.research-workflows/<slug>.md`. Public branch: a plain atomic
 * file write into the user's chosen save directory — no git.
 */
export async function saveWorkflow(vaultRoot: string, doc: WorkflowDoc): Promise<{ path: string }> {
  if (!vaultRoot) throw new Error('尚未配置保存目录：请在设置中指定一个保存目录。');
  const path = await writeWorkflowFile(vaultRoot, doc);
  return { path };
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

/**
 * Delete a workflow by its file slug, falling back to a scan-by-id (mirrors
 * loadWorkflow's resolution). Returns true if a file was removed, false if none
 * matched. Path is asserted inside the vault before unlinking.
 */
export async function deleteWorkflow(vaultRoot: string, slugOrId: string): Promise<boolean> {
  if (!vaultRoot) throw new Error('尚未配置保存目录：请在设置中指定一个保存目录。');
  // Direct slug path first.
  try {
    await unlink(resolveInsideVault(vaultRoot, relPathFor(slugify(slugOrId))));
    return true;
  } catch {
    // fall through to scan-by-id
  }
  const dir = join(vaultRoot, WORKFLOWS_DIR);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.md'));
  } catch {
    return false;
  }
  for (const n of names) {
    try {
      const doc = parseWorkflowDoc(await readFile(join(dir, n), 'utf8'));
      if (doc && (doc.id === slugOrId || n.replace(/\.md$/, '') === slugOrId)) {
        await unlink(resolveInsideVault(vaultRoot, `${WORKFLOWS_DIR}/${n}`));
        return true;
      }
    } catch {
      // skip unreadable file
    }
  }
  return false;
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
