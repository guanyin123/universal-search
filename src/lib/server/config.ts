export interface AppConfig {
  vaultRoot: string;
  /**
   * Raw env-derived LLM config. All fields are OPTIONAL: AI-model config now lives in
   * the in-app settings store (channels). These env vars are only a first-run seed /
   * fallback — see `settings/resolve.ts`. Use `LlmRuntimeConfig` for the resolved,
   * always-concrete config that `makeLlm` consumes.
   */
  llm: {
    baseURL?: string;
    apiKey?: string;
    fanoutModel?: string;
    synthModel?: string;
    models: string[]; // fallback allowlist when provider /models is unavailable
  };
  tavily: { apiKey: string };
  exa: { apiKey?: string };
  community: { enabled: boolean };
  unsplash: { accessKey?: string };
  jina: { apiKey?: string };
  /** GitHub tool-search mode. token is optional — anonymous works (lower rate limit). */
  github: { token?: string };
}

/**
 * Fully-resolved LLM config consumed by `makeLlm`. Produced by `settings/resolve.ts`
 * from the active channel (or the env fallback) — every field is concrete here.
 */
export interface LlmRuntimeConfig {
  baseURL: string;
  apiKey: string;
  fanoutModel: string;
  synthModel: string;
  models: string[];
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v || v.trim() === '') throw new Error(`Missing required env var: ${key}`);
  return v.trim();
}

export function loadConfig(env: Env = process.env): AppConfig {
  return {
    vaultRoot: required(env, 'VAULT_ROOT'),
    llm: {
      // Optional: channels (the in-app settings store) are the source of truth.
      // These are kept only as a first-run seed / fallback.
      baseURL: env.LLM_BASE_URL?.trim() || undefined,
      apiKey: env.LLM_API_KEY?.trim() || undefined,
      fanoutModel: env.FANOUT_MODEL?.trim() || undefined,
      synthModel: env.SYNTH_MODEL?.trim() || undefined,
      models: (env.LLM_MODELS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    },
    tavily: { apiKey: required(env, 'TAVILY_API_KEY') },
    exa: { apiKey: env.EXA_API_KEY?.trim() || undefined },
    community: { enabled: env.COMMUNITY_ENABLED?.trim() === 'true' },
    unsplash: { accessKey: env.UNSPLASH_ACCESS_KEY?.trim() || undefined },
    jina: { apiKey: env.JINA_API_KEY?.trim() || undefined },
    github: { token: env.GITHUB_TOKEN?.trim() || undefined }
  };
}

let cached: AppConfig | null = null;
/**
 * Lazily load + cache config. Pure: caller supplies the env source.
 * Runtime callers go through runtime-config.ts (which passes SvelteKit's
 * `$env/dynamic/private`); tests pass process.env or an explicit record.
 */
export function getConfig(env: Env = process.env): AppConfig {
  if (!cached) cached = loadConfig(env);
  return cached;
}

/** Test-only: clear the cached config so a fresh getConfig() re-reads process.env. */
export function resetConfigCache(): void {
  cached = null;
}
