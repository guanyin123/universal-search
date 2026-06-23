export interface AppConfig {
  vaultRoot: string;
  llm: {
    baseURL: string;
    apiKey: string;
    fanoutModel: string;
    synthModel: string;
    models: string[]; // fallback allowlist when provider /models is unavailable
  };
  tavily: { apiKey: string };
  exa: { apiKey?: string };
  jina: { apiKey?: string };
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
      baseURL: required(env, 'LLM_BASE_URL'),
      apiKey: required(env, 'LLM_API_KEY'),
      fanoutModel: required(env, 'FANOUT_MODEL'),
      synthModel: required(env, 'SYNTH_MODEL'),
      models: (env.LLM_MODELS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    },
    tavily: { apiKey: required(env, 'TAVILY_API_KEY') },
    exa: { apiKey: env.EXA_API_KEY?.trim() || undefined },
    jina: { apiKey: env.JINA_API_KEY?.trim() || undefined }
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
