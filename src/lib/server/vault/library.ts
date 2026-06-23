import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export interface VaultNote {
  path: string; // vault-relative, e.g. wiki/synthesis/foo.md
  title: string;
  tags: string[];
}

export interface VaultLibrary {
  /** Existing tags ranked by frequency (most-used first) — biases tag reuse. */
  vocab: string[];
  notes: VaultNote[];
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---/;

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Minimal frontmatter reader for the fields we need — title and tags. Handles both
 * the inline form (`tags: [a, b]`) and the block-list form (`tags:` then `  - a`).
 * Returns null when there's no frontmatter block.
 */
export function parseFrontmatterFields(md: string): { title: string; tags: string[] } | null {
  const m = md.match(FRONTMATTER);
  if (!m) return null;
  const lines = m[1].split('\n');
  let title = '';
  let tags: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const titleM = lines[i].match(/^title:\s*(.+)$/);
    if (titleM) {
      title = unquote(titleM[1]);
      continue;
    }
    const tagsM = lines[i].match(/^tags:\s*(.*)$/);
    if (tagsM) {
      const rest = tagsM[1].trim();
      if (rest.startsWith('[')) {
        tags = rest
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map(unquote)
          .filter(Boolean);
      } else if (rest === '') {
        // block list: consume following indented "- item" lines
        for (let j = i + 1; j < lines.length; j++) {
          const item = lines[j].match(/^\s*-\s*(.+)$/);
          if (!item) break;
          const v = unquote(item[1]);
          if (v) tags.push(v);
        }
      }
    }
  }
  return { title, tags };
}

/**
 * Rank existing notes by shared-tag overlap with the target tags (case-insensitive).
 * Returns vault-relative paths, highest overlap first, excluding the note itself and
 * any zero-overlap candidates. Deterministic tie-break by path.
 */
export function rankRelated(
  notes: VaultNote[],
  tags: string[],
  excludePath: string,
  limit = 5
): string[] {
  const target = new Set(tags.map((t) => t.toLowerCase()));
  if (target.size === 0) return [];
  return notes
    .filter((n) => n.path !== excludePath)
    .map((n) => ({
      path: n.path,
      score: n.tags.reduce((s, t) => s + (target.has(t.toLowerCase()) ? 1 : 0), 0)
    }))
    .filter((n) => n.score > 0)
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
    .slice(0, limit)
    .map((n) => n.path);
}

async function walkMd(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // missing dir → no notes (graceful)
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkMd(full)));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * Scan `<vaultRoot>/<subdir>` for existing synthesis notes → a frequency-ranked tag
 * vocabulary plus a note index (path + tags) used to auto-link related[]. Reads only;
 * a missing or unreadable vault yields an empty library so a fresh vault never breaks a run.
 */
export async function readVaultLibrary(
  vaultRoot: string,
  subdir = 'wiki/synthesis'
): Promise<VaultLibrary> {
  const files = await walkMd(join(vaultRoot, subdir));
  const notes: VaultNote[] = [];
  const freq = new Map<string, number>();
  for (const file of files) {
    let md: string;
    try {
      md = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const fm = parseFrontmatterFields(md);
    if (!fm || fm.tags.length === 0) continue;
    notes.push({
      path: relative(vaultRoot, file).split(sep).join('/'),
      title: fm.title,
      tags: fm.tags
    });
    for (const t of fm.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const vocab = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([t]) => t);
  return { vocab, notes };
}
