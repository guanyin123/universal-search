import { getConfig } from '../runtime-config';
import { makeLlm, type Llm } from '../llm/client';
import { makeTavilyRunner } from '../search/tavily';
import { makeExaRunner } from '../search/exa';
import { makeJinaExtractor } from '../search/jina';
import { makeRunStore, type RunStore } from './store';
import type { SourceRunner } from '../search/types';
import type { DimensionKey } from './types';
import { join } from 'node:path';

export interface MachineDeps {
  vaultRoot: string;
  llm: Llm;
  /** Source runners keyed by dimension. web is always present; peoples_writing
   *  (Exa) only when EXA_API_KEY is configured — absent dimensions are simply
   *  never proposed or rendered (graceful degrade). */
  runners: Partial<Record<DimensionKey, SourceRunner>>;
  extract: (url: string) => Promise<string>;
  store: RunStore;
  now: () => Date;
}

export function realDeps(): MachineDeps {
  const cfg = getConfig();
  const runners: Partial<Record<DimensionKey, SourceRunner>> = {
    web: makeTavilyRunner(cfg.tavily.apiKey)
  };
  if (cfg.exa.apiKey) runners.peoples_writing = makeExaRunner(cfg.exa.apiKey);
  return {
    vaultRoot: cfg.vaultRoot,
    llm: makeLlm(cfg.llm),
    runners,
    extract: makeJinaExtractor(cfg.jina.apiKey),
    store: makeRunStore(join(process.cwd(), '.runs')),
    now: () => new Date()
  };
}
