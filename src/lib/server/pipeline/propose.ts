export function buildProposePrompt(question: string): string {
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
  return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 3);
}
