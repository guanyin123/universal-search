/** Filesystem-safe slug. Keeps unicode letters/numbers (incl. CJK), strips path/separator chars. */
export function slugify(input: string): string {
  const cleaned = input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\\/:*?"<>|]+/g, ' ')         // path-unsafe chars -> space
    .replace(/[^\p{L}\p{N}]+/gu, '-')       // any non letter/number run -> dash
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/g, '');
  return cleaned || 'untitled';
}

/** Time-ordered, collision-resistant run id. Injectable rng/now for deterministic tests. */
export function newRunId(rng: () => number = Math.random, now: number = Date.now()): string {
  const t = now.toString(36);
  const r = Math.floor(rng() * 1e9).toString(36);
  return `run-${t}-${r}`;
}
