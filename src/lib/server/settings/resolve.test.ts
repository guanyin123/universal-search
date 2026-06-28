import { describe, it, expect } from 'vitest';
import { resolveLlmConfigFrom } from './resolve';
import type { Channel } from './types';
import type { AppConfig } from '../config';

const envLlm: AppConfig['llm'] = {
  baseURL: 'https://env.example/v1',
  apiKey: 'sk-env',
  fanoutModel: 'env-fanout',
  synthModel: 'env-synth',
  models: ['env-fanout', 'env-synth']
};

const emptyEnv: AppConfig['llm'] = { models: [] };

function storeWith(channel: Channel | null) {
  return { getActiveChannel: () => channel };
}

const channel: Channel = {
  id: 'c1',
  name: 'Custom',
  baseURL: 'https://custom/v1',
  apiKey: 'sk-custom',
  models: ['m-a', 'm-b'],
  fanoutModel: 'm-a',
  synthModel: 'm-b',
  createdAt: '2026-01-01T00:00:00.000Z'
};

describe('resolveLlmConfigFrom', () => {
  it('uses the active channel when present', () => {
    const cfg = resolveLlmConfigFrom(storeWith(channel), envLlm);
    expect(cfg).toEqual({
      baseURL: 'https://custom/v1',
      apiKey: 'sk-custom',
      fanoutModel: 'm-a',
      synthModel: 'm-b',
      models: ['m-a', 'm-b']
    });
  });

  it('falls back to the first model when the channel omits fanout/synth', () => {
    const c = { ...channel, fanoutModel: undefined, synthModel: undefined };
    const cfg = resolveLlmConfigFrom(storeWith(c), emptyEnv);
    expect(cfg.fanoutModel).toBe('m-a');
    expect(cfg.synthModel).toBe('m-a');
  });

  it('falls back to env when there is no active channel', () => {
    const cfg = resolveLlmConfigFrom(storeWith(null), envLlm);
    expect(cfg.baseURL).toBe('https://env.example/v1');
    expect(cfg.apiKey).toBe('sk-env');
  });

  it('falls back to env when the channel is missing base_url/key', () => {
    const broken = { ...channel, apiKey: '' };
    const cfg = resolveLlmConfigFrom(storeWith(broken), envLlm);
    expect(cfg.apiKey).toBe('sk-env');
  });

  it('throws a clear error when neither channel nor env is usable', () => {
    expect(() => resolveLlmConfigFrom(storeWith(null), emptyEnv)).toThrow(/管理渠道/);
  });
});
