import { getConfig } from '../runtime-config';
import { resolveLlmConfig, getSaveDir, getSourceRegion, type SourceRegion } from '../settings';
import { makeLlm, type Llm } from '../llm/client';
import { makeTavilyRunner, makeTavilySiteSearch } from '../search/tavily';
import { makeRedditFetch } from '../search/reddit-auth';
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
  /** Authenticated fetch for Reddit (app-only OAuth) when creds are set; otherwise
   *  the keyless global fetch. Threaded to subreddit scoring + the community runner. */
  redditFetch?: typeof fetch;
  /** Reads the vault's existing notes → tag vocabulary + related-link candidates.
   *  Graceful: a fresh/unreadable vault returns an empty library. */
  readLibrary: () => Promise<VaultLibrary>;
  store: RunStore;
  now: () => Date;
  /** Which region report sources are drawn from (国内/国外/混合). Read once from the
   *  in-app setting; biases community/site proposal. Absent → treated as 'mixed'. */
  sourceRegion?: SourceRegion;
}

export function realDeps(): MachineDeps {
  const cfg = getConfig();
  // The save directory comes from the in-app setting (env VAULT_ROOT only as fallback).
  const saveDir = getSaveDir();
  // Reddit app-only OAuth when creds are set; otherwise the keyless global fetch.
  const redditFetch = makeRedditFetch(
    cfg.reddit.clientId && cfg.reddit.clientSecret
      ? { clientId: cfg.reddit.clientId, clientSecret: cfg.reddit.clientSecret }
      : undefined
  );
  const tavily = makeTavilyRunner(cfg.tavily.apiKey);
  const exa = cfg.exa.apiKey ? makeExaRunner(cfg.exa.apiKey) : undefined;
  const runners: Partial<Record<DimensionKey, SourceRunner>> = {
    // web/peoples_writing are folded into the 'community' guardrail as broad cards;
    // they stay registered only so legacy workflows (with a 'web'/'他人写作' dimension)
    // still replay. github is keyless-anonymous, used only by github mode.
    web: tavily,
    github: makeGithubRunner(cfg.github.token)
  };
  if (exa) runners.peoples_writing = exa;
  // Unified "搜索来源" guardrail — the report-search entry point (always on, no longer
  // gated by COMMUNITY_ENABLED). Vetted subreddit (redditFetch, OAuth when configured) /
  // domain-restricted site / HN targets + opt-in broad cards (open-web Tavily / Exa).
  // Missing keys → those targets fail gracefully per-source.
  runners.community = makeCommunityRunner({
    fetchFn: redditFetch,
    siteSearch: cfg.tavily.apiKey ? makeTavilySiteSearch(cfg.tavily.apiKey) : undefined,
    webSearch: (q) => tavily.run(q),
    writingSearch: exa ? (q) => exa.run(q) : undefined
  });
  if (cfg.unsplash.accessKey) runners.images = makeUnsplashRunner(cfg.unsplash.accessKey);
  return {
    vaultRoot: saveDir,
    // LLM config comes from the active channel (settings store), falling back to env.
    llm: makeLlm(resolveLlmConfig()),
    runners,
    extract: makeJinaExtractor(cfg.jina.apiKey),
    redditFetch,
    readLibrary: () => readVaultLibrary(saveDir),
    store: makeRunStore(join(process.cwd(), '.runs')),
    now: () => new Date(),
    sourceRegion: getSourceRegion()
  };
}
