import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
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
