import type { DimensionKey } from '../runs/types';

export function buildProposePrompt(question: string, dimension: DimensionKey = 'web'): string {
  if (dimension === 'peoples_writing') {
    return [
      'You plan a search for INDIVIDUAL, opinionated long-form writing —',
      'personal blog posts, essays, newsletters, first-person deep dives —',
      'on a research question, NOT official docs or news articles.',
      'Output ONLY a JSON array of 2-3 concise search query strings that surface',
      'thoughtful personal perspectives from complementary angles.',
      'No prose, no keys — just the array.',
      '',
      `Question: ${question}`
    ].join('\n');
  }
  if (dimension === 'community') {
    return [
      'You plan a search across community discussion forums (Reddit, Hacker News)',
      'for first-hand experiences, debates, and practitioner opinions on a research',
      'question — what real people report, recommend, or warn against.',
      'Output ONLY a JSON array of 2-3 concise search query strings (keywords, not',
      'questions) likely to match relevant threads from complementary angles.',
      'No prose, no keys — just the array.',
      '',
      `Question: ${question}`
    ].join('\n');
  }
  return [
    'You plan web searches for a research question.',
    'Output ONLY a JSON array of 2-3 concise, high-signal web search query strings',
    'that together cover the question from complementary angles.',
    'No prose, no keys — just the array.',
    '',
    `Question: ${question}`
  ].join('\n');
}

export function parseProposedQueries(raw: string): string[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Could not parse query array from model output: ${raw.slice(0, 120)}`);
  let arr: unknown;
  try {
    arr = JSON.parse(match[0]);
  } catch {
    throw new Error(`Could not parse query array (invalid JSON): ${match[0].slice(0, 120)}`);
  }
  if (!Array.isArray(arr)) throw new Error('Parsed value is not an array');
  const queries = arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 3);
  if (queries.length === 0) {
    throw new Error('Could not parse query array: model returned no usable queries');
  }
  return queries;
}
