export interface Frontmatter {
  title: string;
  type: 'synthesis';
  created: string;
  updated: string;
  tags: string[];
  sources: string[];
  related: string[];
  confidence: 'high' | 'medium' | 'low';
  status: 'draft';
}

export function buildFrontmatter(input: {
  title: string;
  date: string;
  tags: string[];
  sources: string[];
  related: string[];
}): Frontmatter {
  return {
    title: input.title,
    type: 'synthesis',
    created: input.date,
    updated: input.date,
    tags: input.tags,
    sources: input.sources,
    related: input.related,
    confidence: 'medium',
    status: 'draft'
  };
}

// Scalars YAML would misparse as a non-string (keyword) — must be quoted.
const YAML_RESERVED = new Set(['null', 'true', 'false', 'yes', 'no', 'on', 'off', '~']);

/**
 * Emit a safe YAML scalar. When the value could break the frontmatter block
 * (newline/tab), be misread as a YAML indicator/flow char, look like a reserved
 * keyword, or have edge whitespace, JSON-stringify it (a valid YAML double-quoted
 * scalar). Otherwise emit it bare to match the vault's plain style.
 */
function yamlString(s: string): string {
  const risky =
    s === '' ||
    YAML_RESERVED.has(s.toLowerCase()) ||
    /[\n\r\t]/.test(s) || // newlines/tabs would break the block
    /[:#\[\]{}&*!|>%@`"',]/.test(s) || // YAML indicator / flow chars
    /^[\s>|*&!#%@`"',?-]/.test(s) || // dangerous leading char
    /\s$/.test(s); // trailing whitespace
  return risky ? JSON.stringify(s) : s;
}
const yamlArray = (a: string[]) => `[${a.map(yamlString).join(', ')}]`;

export function serializeFrontmatter(fm: Frontmatter): string {
  return [
    '---',
    `title: ${yamlString(fm.title)}`,
    `type: ${fm.type}`,
    `created: ${fm.created}`,
    `updated: ${fm.updated}`,
    `tags: ${yamlArray(fm.tags)}`,
    `sources: ${yamlArray(fm.sources)}`,
    `related: ${yamlArray(fm.related)}`,
    `confidence: ${fm.confidence}`,
    `status: ${fm.status}`,
    '---'
  ].join('\n');
}
