import { describe, it, expect } from 'vitest';
import { buildCompressPrompt, truncateForBudget } from './compress';

describe('buildCompressPrompt', () => {
  it('includes question, source title and the (truncated) content', () => {
    const p = buildCompressPrompt('Q?', 'Title', 'long content here');
    expect(p).toContain('Q?');
    expect(p).toContain('Title');
    expect(p).toContain('long content here');
  });
  it('truncates overly long content inside the prompt', () => {
    const p = buildCompressPrompt('Q?', 'Title', 'x'.repeat(20000));
    expect(p).toContain('…[truncated]');
  });
});

describe('truncateForBudget', () => {
  it('returns text unchanged when under the cap', () => {
    expect(truncateForBudget('short', 100)).toBe('short');
  });
  it('truncates and marks elision when over the cap', () => {
    const out = truncateForBudget('a'.repeat(50), 10);
    expect(out.length).toBeLessThan(50);
    expect(out).toContain('…[truncated]');
  });
});
