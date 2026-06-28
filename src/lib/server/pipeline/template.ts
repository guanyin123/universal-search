import type { Evidence, DimensionKey } from '../runs/types';

const DIM_LABEL: Record<DimensionKey, string> = {
  web: 'Web',
  peoples_writing: '他人写作',
  community: '社区',
  images: '图片',
  github: 'GitHub'
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

/**
 * The Smart-Default instruction block (everything before the per-run Question +
 * Evidence). Exposed so v3 reusable workflows can capture / override the synthesis
 * prompt as structured data while replay still reuses `composeSynthesisPrompt`.
 */
export const SMART_DEFAULT_INSTRUCTIONS = [
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
  '- Begin the document with an H1 line: "# " followed by a faithful restatement of the question.'
].join('\n');

function evidenceBlock(evidence: Evidence[]): string {
  return evidence
    .map((e, i) => `[${i + 1}] (${DIM_LABEL[e.dimension] ?? e.dimension}) ${e.title} — ${e.url}\n${e.compressed}`)
    .join('\n\n');
}

/** Compose a synthesis prompt from an instruction block + the run's question + evidence. */
export function composeSynthesisPrompt(instructions: string, question: string, evidence: Evidence[]): string {
  return [instructions, '', `Question: ${question}`, '', '=== EVIDENCE ===', evidenceBlock(evidence)].join('\n');
}

export function buildSynthesisPrompt(question: string, evidence: Evidence[]): string {
  return composeSynthesisPrompt(SMART_DEFAULT_INSTRUCTIONS, question, evidence);
}
