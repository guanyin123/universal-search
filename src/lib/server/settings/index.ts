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

/** app_settings key for the user-chosen save directory (replaces the hard-coded vault). */
const SAVE_DIR_KEY = 'save_dir';

/**
 * The effective directory reports/workflows are saved into: the in-app setting,
 * falling back to the optional `VAULT_ROOT` env (back-compat with the author's own
 * branch), else `''` (unset → callers surface a "未配置保存目录" error).
 */
export function getSaveDir(): string {
  const stored = getSettings().getSetting(SAVE_DIR_KEY);
  if (stored && stored.trim()) return stored.trim();
  return getConfig().vaultRoot ?? '';
}

/** Persist the user-chosen save directory (in-app setting). */
export function setSaveDir(dir: string): void {
  getSettings().setSetting(SAVE_DIR_KEY, dir.trim());
}

/** Which region a report's sources should be drawn from: 国内 / 国外 / 混合. Biases
 *  dimension proposal + community/site picking; see pipeline/community-targets.ts. */
export type SourceRegion = 'domestic' | 'foreign' | 'mixed';

/** app_settings key for the user-chosen information-source region. */
const SOURCE_REGION_KEY = 'source_region';

/** The effective source region, defaulting to 'mixed' (both domestic + foreign) so
 *  existing behavior is unchanged until the user opts into 国内/国外. */
export function getSourceRegion(): SourceRegion {
  const v = getSettings().getSetting(SOURCE_REGION_KEY);
  return v === 'domestic' || v === 'foreign' ? v : 'mixed';
}

/** Persist the user-chosen information-source region (in-app setting). */
export function setSourceRegion(region: SourceRegion): void {
  getSettings().setSetting(SOURCE_REGION_KEY, region);
}
