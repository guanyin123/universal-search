/** Char-budget guard so a huge page can't blow up the fanout token cost. ~4 chars/token heuristic. */
export function truncateForBudget(text: string, maxChars = 12000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n…[truncated]';
}

export function buildCompressPrompt(question: string, title: string, content: string): string {
  return [
    'Extract only the facts from this source that help answer the question.',
    'Write 4-8 dense bullet points. Preserve concrete numbers, names, and claims.',
    'If the source is irrelevant, reply exactly: IRRELEVANT.',
    '',
    `Question: ${question}`,
    `Source title: ${title}`,
    '--- SOURCE START ---',
    truncateForBudget(content),
    '--- SOURCE END ---'
  ].join('\n');
}
