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

const yamlString = (s: string) => (/[:#\-\[\]{}]/.test(s) ? JSON.stringify(s) : s);
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
