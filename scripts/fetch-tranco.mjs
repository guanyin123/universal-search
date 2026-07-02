#!/usr/bin/env node
/**
 * Refresh the bundled Tranco domain list used for website popularity scoring.
 *
 *   node scripts/fetch-tranco.mjs
 *
 * Downloads the official Tranco top-1M list, keeps the top 100k (rank,domain),
 * gzips it, and writes `static/tranco-top100k.csv.gz`. The runtime decompresses
 * it with Node's built-in zlib (see src/lib/server/search/tranco.ts) — so the
 * app needs no network and no zip dependency at request time.
 *
 * Extraction shells out to `unzip` (present on macOS/Linux); Tranco ships the
 * list as a single-entry .zip.
 */
import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOP_N = 100_000;
const URL = 'https://tranco-list.eu/top-1m.csv.zip';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'tranco-top100k.csv.gz');

async function main() {
  console.log(`Downloading ${URL} …`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Tranco download failed: ${res.status}`);
  const zipBuf = Buffer.from(await res.arrayBuffer());

  const dir = mkdtempSync(join(tmpdir(), 'tranco-'));
  const zipPath = join(dir, 'top-1m.csv.zip');
  writeFileSync(zipPath, zipBuf);

  console.log('Extracting …');
  // -p streams the single entry to stdout; bump maxBuffer for the ~20MB CSV.
  const csv = execSync(`unzip -p ${zipPath}`, { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');

  const top = csv.split('\n').slice(0, TOP_N).join('\n');
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, gzipSync(Buffer.from(top, 'utf8')));
  console.log(`Wrote ${OUT} (top ${TOP_N.toLocaleString()} domains).`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
