import { describe, it, expect } from 'vitest';
import { serializeWorkflowDoc, parseWorkflowDoc } from './serialize';
import type { WorkflowDoc } from './types';

function sampleDoc(over: Partial<WorkflowDoc> = {}): WorkflowDoc {
  return {
    id: 'wf-rag',
    name: 'RAG 调研',
    version: 1,
    mode: 'report',
    archetype: 'smart-default',
    questionPattern: 'How does RAG improve accuracy?',
    dimensions: [
      { key: 'web', label: 'Web' },
      { key: 'peoples_writing', label: '他人写作' }
    ],
    sources: [
      { dimension: 'web', api: 'tavily', query: '{{question}} overview: deep-dive' },
      { dimension: 'web', api: 'tavily', query: 'rag benchmarks' },
      { dimension: 'peoples_writing', api: 'exa', query: 'RAG essays "first person"' }
    ],
    deposit: { reportDir: 'wiki/synthesis', rawDir: 'raw/research' },
    modelConfig: { fanout: 'gpt-4o-mini', synth: 'gpt-4o' },
    runHistory: [{ id: 'run-abc', date: '2026-06-24', question: 'How does RAG improve accuracy?' }],
    templateSections: ['## 核心发现', '## 来源'],
    synthesisPrompt: 'You are a careful analyst.\nRules:\n- cite [1]\n## 核心发现',
    ...over
  };
}

describe('serialize/parse round-trip', () => {
  it('preserves every field through serialize → parse', () => {
    const doc = sampleDoc();
    const round = parseWorkflowDoc(serializeWorkflowDoc(doc));
    expect(round).toEqual(doc);
  });

  it('round-trips risky scalars (colons, quotes, CJK, leading dash, braces)', () => {
    const doc = sampleDoc({
      name: 'a: b "c" 中文',
      questionPattern: '- leading dash & {braces}',
      sources: [{ dimension: 'web', api: 'tavily', query: 'url https://x.com/y?a=1: tricky' }]
    });
    const round = parseWorkflowDoc(serializeWorkflowDoc(doc));
    expect(round?.name).toBe('a: b "c" 中文');
    expect(round?.questionPattern).toBe('- leading dash & {braces}');
    expect(round?.sources[0].query).toBe('url https://x.com/y?a=1: tricky');
  });

  it('preserves a multi-line synthesis prompt verbatim', () => {
    const doc = sampleDoc();
    const round = parseWorkflowDoc(serializeWorkflowDoc(doc));
    expect(round?.synthesisPrompt).toBe(doc.synthesisPrompt);
  });

  it('round-trips a github-mode workflow', () => {
    const doc = sampleDoc({
      mode: 'github',
      dimensions: [{ key: 'github', label: 'GitHub' }],
      sources: [{ dimension: 'github', api: 'github', query: '{{question}} language:rust stars:>500' }]
    });
    const round = parseWorkflowDoc(serializeWorkflowDoc(doc));
    expect(round?.mode).toBe('github');
    expect(round?.sources[0].api).toBe('github');
    expect(round).toEqual(doc);
  });

  it('defaults mode to "report" when the frontmatter has no mode key (legacy docs)', () => {
    const md = serializeWorkflowDoc(sampleDoc()).replace(/^mode: .*$\n/m, '');
    expect(md).not.toContain('mode:');
    expect(parseWorkflowDoc(md)?.mode).toBe('report');
  });
});

describe('parseWorkflowDoc degradation', () => {
  it('returns null on content with no frontmatter', () => {
    expect(parseWorkflowDoc('# just a heading\nno frontmatter')).toBeNull();
  });
  it('returns null when identity (id/name) is missing', () => {
    expect(parseWorkflowDoc('---\nversion: 1\n---\nbody')).toBeNull();
  });
  it('returns null on garbage', () => {
    expect(parseWorkflowDoc('}{not yaml at all')).toBeNull();
  });
});
