import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

/**
 * Website popularity scoring via a bundled Tranco top-domain list.
 *
 * Tranco (https://tranco-list.eu) is a research-grade, manipulation-hardened
 * ranking aggregated from multiple providers. We ship a trimmed, gzipped CSV
 * (rank,domain per line — `static/tranco-top100k.csv.gz`) and decompress it with
 * Node's built-in zlib — zero new dependencies, fully offline. Refresh it with
 * `node scripts/fetch-tranco.mjs`.
 *
 * The list is loaded lazily once per process. If it's missing/corrupt the whole
 * thing degrades gracefully: every domain gets a neutral score (so website
 * targets still rank — just by the planner's order — and nothing throws).
 */

const DEFAULT_LIST_PATH = join(process.cwd(), 'static', 'tranco-top100k.csv.gz');

/** Score given to domains not present in the list (or when the list is unavailable). */
const NEUTRAL_SCORE = 8;
const NEUTRAL_LABEL = '未上榜';

/** Strip scheme / `www.` / path / port and lowercase → a bare registrable host. */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, ''); // scheme
  d = d.replace(/\/.*$/, ''); // path
  d = d.replace(/:\d+$/, ''); // port
  d = d.replace(/^www\./, ''); // www.
  return d;
}

/** Parse a decompressed `rank,domain\n…` CSV into a domain→rank Map. */
export function parseTrancoCsv(csv: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of csv.split('\n')) {
    const comma = line.indexOf(',');
    if (comma <= 0) continue;
    const rank = Number(line.slice(0, comma));
    const domain = line.slice(comma + 1).trim().toLowerCase();
    if (!Number.isFinite(rank) || !domain) continue;
    // First (best) rank wins if a domain somehow repeats.
    if (!map.has(domain)) map.set(domain, rank);
  }
  return map;
}

/** Load + decompress + parse the bundled list. Throws if the file can't be read. */
export function loadTrancoMap(filePath: string = DEFAULT_LIST_PATH): Map<string, number> {
  const buf = readFileSync(filePath);
  const csv = gunzipSync(buf).toString('utf8');
  return parseTrancoCsv(csv);
}

let cached: Map<string, number> | null = null;
let warned = false;

/** Lazily load the list once; on failure cache an empty Map (neutral scores). */
function ensureMap(): Map<string, number> {
  if (cached) return cached;
  try {
    cached = loadTrancoMap();
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(
        '[tranco] domain list unavailable — website targets get a neutral score. ' +
          'Run `node scripts/fetch-tranco.mjs` to bundle it.',
        err instanceof Error ? err.message : err
      );
    }
    cached = new Map();
  }
  return cached;
}

/** Pure: turn a Tranco rank (or undefined) into a 0-100 priority score. */
export function trancoScoreFromRank(rank: number | undefined): { score: number; scoreLabel: string } {
  if (!rank || !Number.isFinite(rank)) return { score: NEUTRAL_SCORE, scoreLabel: NEUTRAL_LABEL };
  // rank 1 → 100, rank 1,000,000 → 0 (log-scaled so the head dominates).
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - Math.log10(rank) / 6))));
  return { score, scoreLabel: `排名 #${rank}` };
}

/**
 * Score a website domain by its Tranco rank. `rankMap` is injectable for tests;
 * production omits it and uses the lazily-loaded bundled list.
 */
export function scoreDomain(
  domain: string,
  rankMap: Map<string, number> = ensureMap()
): { score: number; scoreLabel: string } {
  const rank = rankMap.get(normalizeDomain(domain));
  return trancoScoreFromRank(rank);
}
