import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

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

  it('throws a clear error when a required var is missing', () => {
    const { TAVILY_API_KEY, ...missing } = base;
    expect(() => loadConfig(missing)).toThrow(/TAVILY_API_KEY/);
  });
});
