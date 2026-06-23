import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, getConfig, resetConfigCache } from './config';

const base = {
  VAULT_ROOT: '/tmp/vault',
  LLM_BASE_URL: 'https://api.openai.com/v1',
  LLM_API_KEY: 'sk-test',
  FANOUT_MODEL: 'gpt-4o-mini',
  SYNTH_MODEL: 'gpt-4o',
  TAVILY_API_KEY: 'tvly-test'
};

describe('loadConfig', () => {
  it('parses a full env into AppConfig', () => {
    const cfg = loadConfig({ ...base, LLM_MODELS: 'gpt-4o,gpt-4o-mini', JINA_API_KEY: 'jina-x' });
    expect(cfg.vaultRoot).toBe('/tmp/vault');
    expect(cfg.llm.fanoutModel).toBe('gpt-4o-mini');
    expect(cfg.llm.models).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(cfg.jina.apiKey).toBe('jina-x');
  });

  it('defaults models to [] and jina apiKey to undefined when absent', () => {
    const cfg = loadConfig(base);
    expect(cfg.llm.models).toEqual([]);
    expect(cfg.jina.apiKey).toBeUndefined();
  });

  it('parses EXA_API_KEY when present and is undefined when absent', () => {
    expect(loadConfig({ ...base, EXA_API_KEY: 'exa-x' }).exa.apiKey).toBe('exa-x');
    expect(loadConfig(base).exa.apiKey).toBeUndefined();
  });

  it('enables the community dimension only when COMMUNITY_ENABLED is exactly "true"', () => {
    expect(loadConfig({ ...base, COMMUNITY_ENABLED: 'true' }).community.enabled).toBe(true);
    expect(loadConfig({ ...base, COMMUNITY_ENABLED: '1' }).community.enabled).toBe(false);
    expect(loadConfig(base).community.enabled).toBe(false);
  });

  it('throws a clear error when a required var is missing', () => {
    const { TAVILY_API_KEY, ...missing } = base;
    expect(() => loadConfig(missing)).toThrow(/TAVILY_API_KEY/);
  });
});

describe('getConfig cache', () => {
  afterEach(() => resetConfigCache());

  it('caches across calls and resetConfigCache clears it', () => {
    const prev = { ...process.env };
    process.env.VAULT_ROOT = '/tmp/v1';
    process.env.LLM_BASE_URL = 'https://api.openai.com/v1';
    process.env.LLM_API_KEY = 'sk';
    process.env.FANOUT_MODEL = 'f';
    process.env.SYNTH_MODEL = 's';
    process.env.TAVILY_API_KEY = 't';
    resetConfigCache();
    const a = getConfig();
    const b = getConfig();
    expect(a).toBe(b); // same cached instance
    resetConfigCache();
    const c = getConfig();
    expect(c).not.toBe(a); // fresh instance after reset
    Object.assign(process.env, prev);
  });
});
