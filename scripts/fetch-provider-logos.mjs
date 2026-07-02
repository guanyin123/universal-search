#!/usr/bin/env node
/**
 * Download brand SVG logos for the built-in provider presets (src/lib/providers.ts)
 * into `static/providers/{id}.svg`, so the "管理 AI 渠道" gallery renders official
 * marks fully offline at request time.
 *
 *   node scripts/fetch-provider-logos.mjs
 *
 * Source: models.dev's logo endpoint (https://models.dev/logos/{slug}.svg) — the
 * same open-source AI-model DB used for the preset list. Provider ids here may map to
 * a different models.dev slug, so each entry lists candidate slugs and we take the
 * first that returns an SVG. A miss is skipped (the UI falls back to a monogram chip).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// preset id → candidate models.dev logo slugs (first hit wins)
const LOGOS = {
  openai: ['openai'],
  deepseek: ['deepseek'],
  moonshot: ['moonshotai', 'moonshot'],
  zhipu: ['zhipuai', 'z-ai', 'zhipu'],
  openrouter: ['openrouter'],
  groq: ['groq'],
  together: ['togetherai', 'together'],
  mistral: ['mistral'],
  google: ['google', 'google-vertex'],
  xai: ['xai'],
  alibaba: ['alibaba', 'alibaba-cn', 'dashscope'],
  siliconflow: ['siliconflow'],
  ollama: ['ollama']
};

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'providers');

async function fetchSvg(slug) {
  const url = `https://models.dev/logos/${slug}.svg`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const svg = await res.text();
  // Guard against HTML error pages served with 200.
  return svg.includes('<svg') ? svg : null;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let ok = 0;
  const missing = [];
  for (const [id, slugs] of Object.entries(LOGOS)) {
    let svg = null;
    for (const slug of slugs) {
      try {
        svg = await fetchSvg(slug);
      } catch {
        svg = null;
      }
      if (svg) break;
    }
    if (svg) {
      writeFileSync(join(OUT_DIR, `${id}.svg`), svg, 'utf8');
      ok++;
      console.log(`✓ ${id}`);
    } else {
      missing.push(id);
      console.log(`· ${id} — no logo (UI will use a monogram)`);
    }
  }
  console.log(`\nWrote ${ok} logos to ${OUT_DIR}.` + (missing.length ? ` Missing: ${missing.join(', ')}.` : ''));
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
