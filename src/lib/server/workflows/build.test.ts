import { describe, it, expect } from 'vitest';
import {
  buildWorkflowDoc,
  deriveQuestionPattern,
  templatizeQuery,
  hydrateQuery,
  planFromWorkflow,
  makeWorkflowSynthPrompt,
  QUESTION_PLACEHOLDER
} from './build';
import type { Run, Evidence } from '../runs/types';

function sampleRun(over: Partial<Run> = {}): Run {
  return {
    id: 'run-abc',
    createdAt: '2026-06-24T08:30:00Z',
    status: 'awaiting_deposit',
    question: 'How does RAG improve LLM accuracy?',
    models: { fanout: 'gpt-4o-mini', synth: 'gpt-4o' },
    plan: {
      dimensions: [
        {
          key: 'web',
          label: 'Web',
          enabled: true,
          sources: [
            { id: 'web-1', api: 'tavily', query: 'How does RAG improve LLM accuracy? overview', enabled: true },
            { id: 'web-2', api: 'tavily', query: 'retrieval augmented generation benchmarks', enabled: true },
            { id: 'web-3', api: 'tavily', query: 'disabled', enabled: false }
          ]
        },
        {
          key: 'peoples_writing',
          label: '他人写作',
          enabled: true,
          sources: [{ id: 'peoples_writing-1', api: 'exa', query: 'RAG essays', enabled: true }]
        },
        {
          key: 'images',
          label: '图片',
          enabled: false,
          sources: [{ id: 'images-1', api: 'unsplash', query: 'library', enabled: true }]
        }
      ]
    },
    evidence: [],
    report: { templateKey: 'smart-default', frontmatter: {} as any, markdown: '# x' },
    ...over
  };
}

describe('deriveQuestionPattern', () => {
  it('collapses whitespace and trims', () => {
    expect(deriveQuestionPattern('  How   does \n RAG  work? ')).toBe('How does RAG work?');
  });
});

describe('templatizeQuery / hydrateQuery', () => {
  it('replaces the originating question (case-insensitive) with a placeholder', () => {
    expect(templatizeQuery('how does RAG WORK overview', 'how does rag work')).toBe(
      `${QUESTION_PLACEHOLDER} overview`
    );
  });
  it('keeps a keyword query verbatim when the question never appears', () => {
    expect(templatizeQuery('rag benchmarks', 'how does rag work')).toBe('rag benchmarks');
  });
  it('hydrate fills the placeholder; verbatim templates pass through', () => {
    expect(hydrateQuery(`${QUESTION_PLACEHOLDER} overview`, 'NEWQ')).toBe('NEWQ overview');
    expect(hydrateQuery('rag benchmarks', 'NEWQ')).toBe('rag benchmarks');
  });
});

describe('buildWorkflowDoc', () => {
  const doc = buildWorkflowDoc(sampleRun());

  it('derives id from the name and carries the spec §9 frontmatter fields', () => {
    expect(doc.id).toBe('wf-how-does-rag-improve-llm-accuracy');
    expect(doc.name).toBe('How does RAG improve LLM accuracy?');
    expect(doc.version).toBe(1);
    expect(doc.archetype).toBe('smart-default');
    expect(doc.modelConfig).toEqual({ fanout: 'gpt-4o-mini', synth: 'gpt-4o' });
    expect(doc.deposit).toEqual({ reportDir: 'wiki/synthesis', rawDir: 'raw/research' });
    expect(doc.runHistory).toEqual([{ id: 'run-abc', date: '2026-06-24', question: 'How does RAG improve LLM accuracy?' }]);
    expect(doc.synthesisPrompt).toContain('careful research analyst');
  });

  it('takes dimensions/sources from run.plan, excluding disabled dimensions and sources', () => {
    expect(doc.dimensions.map((d) => d.key)).toEqual(['web', 'peoples_writing']); // images disabled
    // web-3 (disabled) excluded; 2 web + 1 peoples_writing = 3
    expect(doc.sources).toHaveLength(3);
    expect(doc.sources.filter((s) => s.dimension === 'web')).toHaveLength(2);
  });

  it('templatizes queries that embedded the original question', () => {
    const web1 = doc.sources.find((s) => s.query.includes('overview'));
    expect(web1?.query).toBe(`${QUESTION_PLACEHOLDER} overview`);
  });

  it('honors an explicit name/id override', () => {
    const d2 = buildWorkflowDoc(sampleRun(), { name: 'RAG 调研范式', id: 'wf-custom' });
    expect(d2.id).toBe('wf-custom');
    expect(d2.name).toBe('RAG 调研范式');
  });
});

describe('planFromWorkflow', () => {
  it('hydrates a reusable plan for a new question (skips proposing)', () => {
    const doc = buildWorkflowDoc(sampleRun());
    const plan = planFromWorkflow(doc, 'What makes RAG reliable?');
    expect(plan.dimensions.map((d) => d.key)).toEqual(['web', 'peoples_writing']);
    const web = plan.dimensions[0];
    expect(web.sources.map((s) => s.id)).toEqual(['web-1', 'web-2']);
    expect(web.sources.every((s) => s.enabled)).toBe(true);
    // placeholder query bound to the new question; keyword query verbatim
    expect(web.sources[0].query).toBe('What makes RAG reliable? overview');
    expect(web.sources[1].query).toBe('retrieval augmented generation benchmarks');
  });
});

describe('makeWorkflowSynthPrompt', () => {
  it('composes the workflow prompt with the new question + evidence', () => {
    const doc = buildWorkflowDoc(sampleRun());
    const ev: Evidence[] = [
      { sourceId: 's1', dimension: 'web', url: 'https://a.com', title: 'A', compressed: '- fact', retrievedAt: '2026-06-24' }
    ];
    const prompt = makeWorkflowSynthPrompt(doc)('NEWQ', ev);
    expect(prompt).toContain('careful research analyst');
    expect(prompt).toContain('NEWQ');
    expect(prompt).toContain('https://a.com');
  });
});
