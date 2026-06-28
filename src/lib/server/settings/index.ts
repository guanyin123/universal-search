import { join } from 'node:path';
import { getConfig } from '../runtime-config';
import type { LlmRuntimeConfig } from '../config';
import { makeSettingsStore, type SettingsStore } from './store';
import { resolveLlmConfigFrom } from './resolve';

export type { SettingsStore } from './store';
export type { Channel, ChannelInput, ChannelPatch, ChannelPublic } from './types';

let store: SettingsStore | null = null;

/**
 * Process-wide singleton settings store (one SQLite connection, reused across
 * requests — mirrors `events.ts`'s `bus`). On first init, seeds a channel from the
 * env `LLM_*` vars so existing deployments migrate seamlessly (no-op once any
 * channel exists). Data lives in `.data/` under the process cwd.
 */
export function getSettings(): SettingsStore {
  if (!store) {
    store = makeSettingsStore(join(process.cwd(), '.data'));
    const env = getConfig().llm;
    const seed =
      env.baseURL && env.apiKey && env.fanoutModel && env.synthModel
        ? {
            name: '默认（来自 .env）',
            baseURL: env.baseURL,
            apiKey: env.apiKey,
            models: env.models,
            fanoutModel: env.fanoutModel,
            synthModel: env.synthModel
          }
        : null;
    store.seedFromEnv(seed);
  }
  return store;
}

/**
 * Runtime accessor for the effective LLM config: active channel → env fallback →
 * throw. Glue that wires the singleton store to the pure resolver.
 */
export function resolveLlmConfig(): LlmRuntimeConfig {
  return resolveLlmConfigFrom(getSettings(), getConfig().llm);
}
