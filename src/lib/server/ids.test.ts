import { describe, it, expect } from 'vitest';
import { slugify, newRunId } from './ids';

describe('slugify', () => {
  it('lowercases, strips unsafe chars, collapses dashes', () => {
    expect(slugify('Hello, World! / 2026')).toBe('hello-world-2026');
  });
  it('keeps CJK characters but drops slashes and colons', () => {
    expect(slugify('知识/沉淀: 范式')).toBe('知识-沉淀-范式');
  });
  it('truncates to 80 chars and trims trailing dashes', () => {
    const s = slugify('a'.repeat(200));
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith('-')).toBe(false);
  });
  it('falls back to "untitled" for empty input', () => {
    expect(slugify('!!!')).toBe('untitled');
  });
});

describe('newRunId', () => {
  it('produces a unique-looking id with the run- prefix', () => {
    const id = newRunId(() => 0.5, 1718600000000);
    expect(id).toMatch(/^run-[a-z0-9]+-[a-z0-9]+$/);
  });
});
