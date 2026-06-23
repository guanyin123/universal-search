import type { Evidence, DimensionKey } from '../runs/types';

const DIM_LABEL: Record<DimensionKey, string> = {
  web: 'Web',
  peoples_writing: '他人写作',
  community: '社区',
  images: '图片'
};

export const SMART_DEFAULT_SECTIONS = [
  '## 问题界定',
  '## 核心发现',
  '## 详细展开',
  '## 分歧与警示',
  '## 开放问题',
  '## 行动项',
  '## 来源'
];

export function buildSynthesisPrompt(question: string, evidence: Evidence[]): string {
  const sources = evidence
    .map((e, i) => `[${i + 1}] (${DIM_LABEL[e.dimension] ?? e.dimension}) ${e.title} — ${e.url}\n${e.compressed}`)
    .join('\n\n');

  return [
    'You are a careful research analyst. Write a detailed report in Chinese (Markdown).',
    'Use EXACTLY these section headings in this order:',
    SMART_DEFAULT_SECTIONS.join('\n'),
    '',
    'Rules:',
    '- Start with a 1-2 sentence executive answer as a blockquote (>) under the H1 title.',
    '- In 核心发现, every claim ends with an inline citation like [1] and a confidence tag (置信度: 高/中/低).',
    '- In 来源, group sources by their dimension label (e.g. Web / 他人写作 / 社区 / 图片), listing each numbered source with its URL under its dimension.',
    '- Evidence labeled (图片) is a figure: you MAY embed it inline near relevant text using its provided Markdown (![…](…)), and credit the photographer + Unsplash in its 来源 entry.',
    '- Only use the evidence provided. If evidence is thin, say so in 分歧与警示 / 开放问题.',
    '- Begin the document with an H1 line: "# " followed by a faithful restatement of the question.',
    '',
    `Question: ${question}`,
    '',
    '=== EVIDENCE ===',
    sources
  ].join('\n');
}
