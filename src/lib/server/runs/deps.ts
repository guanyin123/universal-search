import { getConfig } from '../runtime-config';
import { resolveLlmConfig } from '../settings';
import { makeLlm, type Llm } from '../llm/client';
import { makeTavilyRunner } from '../search/tavily';
import { makeExaRunner } from '../search/exa';
import { makeCommunityRunner } from '../search/community';
import { makeUnsplashRunner } from '../search/unsplash';
import { makeGithubRunner } from '../search/github';
import { makeJinaExtractor } from '../search/jina';
import { readVaultLibrary, type VaultLibrary } from '../vault/library';
import { makeRunStore, type RunStore } from './store';
import type { SourceRunner } from '../search/types';
import type { DimensionKey } from './types';
import { join } from 'node:path';

export interface MachineDeps {
  vaultRoot: string;
  llm: Llm;
  /** Source runners keyed by dimension. web is always present; peoples_writing
   *  (Exa) only when EXA_API_KEY is set; community (Reddit+HN, keyless) only when
   *  COMMUNITY_ENABLED=true; images (Unsplash) only when UNSPLASH_ACCESS_KEY is set
   *  — absent dimensions are simply never proposed or rendered (graceful degrade). */
  runners: Partial<Record<DimensionKey, SourceRunner>>;
  extract: (url: string) => Promise<string>;
  /** Reads the vault's existing notes → tag vocabulary + related-link candidates.
   *  Graceful: a fresh/unreadable vault returns an empty library. */
  readLibrary: () => Promise<VaultLibrary>;
  store: RunStore;
  now: () => Date;
}

export function realDeps(): MachineDeps {
  const cfg = getConfig();
  const runners: Partial<Record<DimensionKey, SourceRunner>> = {
    web: makeTavilyRunner(cfg.tavily.apiKey),
    // github is always registered (keyless works anonymously). It's used only by the
    // github-mode functions — it is NOT in DIMENSION_ORDER, so report mode never sees it.
    github: makeGithubRunner(cfg.github.token)
  };
  if (cfg.exa.apiKey) runners.peoples_writing = makeExaRunner(cfg.exa.apiKey);
  if (cfg.community.enabled) runners.community = makeCommunityRunner();
  if (cfg.unsplash.accessKey) runners.images = makeUnsplashRunner(cfg.unsplash.accessKey);
  return {
    vaultRoot: cfg.vaultRoot,
    // LLM config comes from the active channel (settings store), falling back to env.
    llm: makeLlm(resolveLlmConfig()),
    runners,
    extract: makeJinaExtractor(cfg.jina.apiKey),
    readLibrary: () => readVaultLibrary(cfg.vaultRoot),
    store: makeRunStore(join(process.cwd(), '.runs')),
    now: () => new Date()
  };
}
