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
  it('numbers multiple evidence items incrementally', () => {
    const two: Evidence[] = [
      { sourceId: 's1', url: 'https://a.com', title: 'A', compressed: '- a', retrievedAt: '2026-06-17' },
      { sourceId: 's2', url: 'https://b.com', title: 'B', compressed: '- b', retrievedAt: '2026-06-17' }
    ];
    const p = buildSynthesisPrompt('Q?', two);
    expect(p).toContain('[1]');
    expect(p).toContain('[2]');
    expect(p).toContain('https://b.com');
  });
});
