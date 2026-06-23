import type { DimensionKey, SourceApi } from '../runs/types';
import type { WorkflowDoc, WorkflowDimension, WorkflowSource, WorkflowRunRef } from './types';

/**
 * Self-contained serialize/parse for workflow markdown. The project ships no YAML
 * library (and the runner is offline), so this emits/parses exactly the controlled
 * frontmatter shapes we use: top-level scalars, one-level maps (model_config/deposit),
 * and lists of flat maps (dimensions/sources/run_history). Risky scalars are
 * JSON-double-quoted (a valid YAML scalar), so values stay single-line and round-trip.
 */

const RESERVED = new Set(['null', 'true', 'false', 'yes', 'no', 'on', 'off', '~']);

function emitScalar(v: string): string {
  const risky =
    v === '' ||
    RESERVED.has(v.toLowerCase()) ||
    /[\n\r\t]/.test(v) ||
    /[:#[\]{}&*!|>%@`"',]/.test(v) ||
    /^[\s>|*&!#%@`"',?-]/.test(v) ||
    /\s$/.test(v);
  return risky ? JSON.stringify(v) : v;
}

function parseScalar(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t;
    }
  }
  return t;
}

const REPORT_OPEN = '<!-- report-template -->';
const REPORT_CLOSE = '<!-- /report-template -->';
const SYNTH_OPEN = '<!-- synthesis-prompt -->';
const SYNTH_CLOSE = '<!-- /synthesis-prompt -->';

function emitItem(fields: Array<[string, string]>): string {
  return fields
    .map(([k, v], i) => `${i === 0 ? '  - ' : '    '}${k}: ${emitScalar(v)}`)
    .join('\n');
}

export function serializeWorkflowDoc(doc: WorkflowDoc): string {
  const fm: string[] = ['---'];
  fm.push(`id: ${emitScalar(doc.id)}`);
  fm.push(`name: ${emitScalar(doc.name)}`);
  fm.push(`version: ${doc.version}`);
  fm.push(`archetype: ${emitScalar(doc.archetype)}`);
  fm.push(`question_pattern: ${emitScalar(doc.questionPattern)}`);
  fm.push('model_config:');
  fm.push(`  fanout: ${emitScalar(doc.modelConfig.fanout)}`);
  fm.push(`  synth: ${emitScalar(doc.modelConfig.synth)}`);
  fm.push('deposit:');
  fm.push(`  reportDir: ${emitScalar(doc.deposit.reportDir)}`);
  fm.push(`  rawDir: ${emitScalar(doc.deposit.rawDir)}`);
  fm.push('dimensions:');
  for (const d of doc.dimensions) {
    fm.push(emitItem([['key', d.key], ['label', d.label]]));
  }
  fm.push('sources:');
  for (const s of doc.sources) {
    fm.push(emitItem([['dimension', s.dimension], ['api', s.api], ['query', s.query]]));
  }
  fm.push('run_history:');
  for (const r of doc.runHistory) {
    fm.push(emitItem([['id', r.id], ['date', r.date], ['question', r.question]]));
  }
  fm.push('---');

  const body = [
    '',
    `# ${doc.name}`,
    '',
    `> ${doc.questionPattern}`,
    '',
    '## 报告模板',
    REPORT_OPEN,
    doc.templateSections.join('\n'),
    REPORT_CLOSE,
    '',
    '## 综合 Prompt',
    SYNTH_OPEN,
    doc.synthesisPrompt,
    SYNTH_CLOSE,
    ''
  ].join('\n');

  return `${fm.join('\n')}\n${body}`;
}

function indentOf(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

type Block = Record<string, string> | Array<Record<string, string>>;

function parseBlock(block: string[]): Block {
  if ((block[0]?.trim() ?? '').startsWith('- ')) {
    const items: Array<Record<string, string>> = [];
    let cur: Record<string, string> | null = null;
    for (const ln of block) {
      const t = ln.trim();
      const itemM = t.match(/^- (.*)$/);
      const kvSrc = itemM ? itemM[1] : t;
      if (itemM) {
        cur = {};
        items.push(cur);
      }
      const kv = kvSrc.match(/^([a-zA-Z_]+):(.*)$/);
      if (kv && cur) cur[kv[1]] = parseScalar(kv[2]);
    }
    return items;
  }
  const map: Record<string, string> = {};
  for (const ln of block) {
    const kv = ln.trim().match(/^([a-zA-Z_]+):(.*)$/);
    if (kv) map[kv[1]] = parseScalar(kv[2]);
  }
  return map;
}

function parseFrontmatter(fmText: string): Record<string, string | Block> {
  const lines = fmText.split('\n');
  const top: Record<string, string | Block> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || indentOf(line) !== 0) {
      i++;
      continue;
    }
    const m = line.match(/^([a-z_]+):(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rest = m[2].trim();
    if (rest !== '') {
      top[key] = parseScalar(rest);
      i++;
      continue;
    }
    i++;
    const block: string[] = [];
    while (i < lines.length) {
      if (lines[i].trim() === '' || indentOf(lines[i]) === 0) break;
      block.push(lines[i]);
      i++;
    }
    top[key] = parseBlock(block);
  }
  return top;
}

function between(body: string, open: string, close: string): string {
  const a = body.indexOf(open);
  const b = body.indexOf(close);
  if (a === -1 || b === -1 || b < a) return '';
  return body.slice(a + open.length, b).replace(/^\n+|\n+$/g, '');
}

function asStr(v: string | Block | undefined): string {
  return typeof v === 'string' ? v : '';
}

function asList(v: string | Block | undefined): Array<Record<string, string>> {
  return Array.isArray(v) ? v : [];
}

function asMap(v: string | Block | undefined): Record<string, string> {
  return v && !Array.isArray(v) && typeof v !== 'string' ? v : {};
}

/**
 * Parse a workflow markdown back into a WorkflowDoc. Returns null when the document
 * is unparseable / missing required identity (id + name), so callers degrade gracefully
 * instead of crashing the whole list.
 */
export function parseWorkflowDoc(md: string): WorkflowDoc | null {
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = parseFrontmatter(fmMatch[1]);
  const id = asStr(fm.id);
  const name = asStr(fm.name);
  if (!id || !name) return null;

  const body = md.slice(fmMatch[0].length);
  const mc = asMap(fm.model_config);
  const dep = asMap(fm.deposit);

  const dimensions: WorkflowDimension[] = asList(fm.dimensions).map((d) => ({
    key: d.key as DimensionKey,
    label: d.label ?? d.key
  }));
  const sources: WorkflowSource[] = asList(fm.sources).map((s) => ({
    dimension: s.dimension as DimensionKey,
    api: s.api as SourceApi,
    query: s.query ?? ''
  }));
  const runHistory: WorkflowRunRef[] = asList(fm.run_history).map((r) => ({
    id: r.id ?? '',
    date: r.date ?? '',
    question: r.question ?? ''
  }));

  const synthesisPrompt = between(body, SYNTH_OPEN, SYNTH_CLOSE);
  const templateSections = between(body, REPORT_OPEN, REPORT_CLOSE)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return {
    id,
    name,
    version: Number(asStr(fm.version)) || 1,
    archetype: asStr(fm.archetype) || 'smart-default',
    questionPattern: asStr(fm.question_pattern),
    dimensions,
    sources,
    deposit: {
      reportDir: dep.reportDir ?? 'wiki/synthesis',
      rawDir: dep.rawDir ?? 'raw/research'
    },
    modelConfig: { fanout: mc.fanout ?? '', synth: mc.synth ?? '' },
    runHistory,
    templateSections,
    synthesisPrompt
  };
}
