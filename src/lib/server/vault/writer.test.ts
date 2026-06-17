import { describe, it, expect } from 'vitest';
import { buildDepositPlan } from './writer';
import type { Evidence } from '../runs/types';
import { buildFrontmatter } from './frontmatter';

const evidence: Evidence[] = [
  { sourceId: 's1', url: 'https://a.com', title: 'Alpha', compressed: '- a', retrievedAt: '2026-06-17' },
  { sourceId: 's2', url: 'https://b.com', title: 'Beta', compressed: '- b', retrievedAt: '2026-06-17' }
];

describe('buildDepositPlan', () => {
  const fm = buildFrontmatter({ title: '什么是 RAG', date: '2026-06-17', tags: ['RAG'], sources: [], related: [] });
  const plan = buildDepositPlan({ slug: '什么是-rag', date: '2026-06-17', frontmatter: fm, reportBody: '# 什么是 RAG\n...', evidence });

  it('writes the synthesis report to wiki/synthesis/<slug>.md', () => {
    const report = plan.files.find((f) => f.kind === 'synthesis')!;
    expect(report.path).toBe('wiki/synthesis/什么是-rag.md');
    expect(report.contents).toContain('type: synthesis');
    expect(report.contents).toContain('# 什么是 RAG');
  });

  it('writes one raw snapshot per source under raw/research/<date>-<slug>/', () => {
    const raws = plan.files.filter((f) => f.kind === 'raw');
    expect(raws).toHaveLength(2);
    expect(raws[0].path).toBe('raw/research/2026-06-17-什么是-rag/1-alpha.md');
    expect(raws[1].path).toBe('raw/research/2026-06-17-什么是-rag/2-beta.md');
    expect(raws[0].contents).toContain('https://a.com');
  });

  it('reportPath points at the synthesis file', () => {
    expect(plan.reportPath).toBe('wiki/synthesis/什么是-rag.md');
  });
});
