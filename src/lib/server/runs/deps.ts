import { getConfig } from '../runtime-config';
import { makeLlm, type Llm } from '../llm/client';
import { makeTavilyRunner } from '../search/tavily';
import { makeJinaExtractor } from '../search/jina';
import { makeRunStore, type RunStore } from './store';
import type { SourceRunner } from '../search/types';
import { join } from 'node:path';

export interface MachineDeps {
  vaultRoot: string;
  llm: Llm;
  web: SourceRunner;
  extract: (url: string) => Promise<string>;
  store: RunStore;
  now: () => Date;
}

export function realDeps(): MachineDeps {
  const cfg = getConfig();
  return {
    vaultRoot: cfg.vaultRoot,
    llm: makeLlm(cfg.llm),
    web: makeTavilyRunner(cfg.tavily.apiKey),
    extract: makeJinaExtractor(cfg.jina.apiKey),
    store: makeRunStore(join(process.cwd(), '.runs')),
    now: () => new Date()
  };
}
