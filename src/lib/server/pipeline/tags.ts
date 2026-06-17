export function buildTagsPrompt(question: string, vocab: string[]): string {
  return [
    'Produce 3-7 short topical tags for a research note.',
    'Prefer reusing tags from this existing vocabulary when they fit:',
    vocab.slice(0, 60).join(', ') || '(none)',
    'Output ONLY a JSON array of tag strings.',
    '',
    `Question: ${question}`
  ].join('\n');
}

export function parseTags(raw: string): string[] {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 7);
  } catch {
    return [];
  }
}
