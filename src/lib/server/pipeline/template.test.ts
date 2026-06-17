import { describe, it, expect } from 'vitest';
import { buildSynthesisPrompt, SMART_DEFAULT_SECTIONS } from './template';
import type { Evidence } from '../runs/types';

const evidence: Evidence[] = [
  { sourceId: 's1', url: 'https://a.com', title: 'A', compressed: '- fact 1', retrievedAt: '2026-06-17' }
];

describe('buildSynthesisPrompt', () => {
  it('lists every default section heading', () => {
    const p = buildSynthesisPrompt('Q?', evidence);
    for (const h of SMART_DEFAULT_SECTIONS) expect(p).toContain(h);
  });
  it('embeds the question and the evidence with numbered citations', () => {
    const p = buildSynthesisPrompt('Q?', evidence);
    expect(p).toContain('Q?');
    expect(p).toContain('[1]');
    expect(p).toContain('https://a.com');
  });
});
