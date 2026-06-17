import { describe, it, expect, vi } from 'vitest';
import { makeLlm } from './client';

const cfg = {
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  fanoutModel: 'gpt-4o-mini',
  synthModel: 'gpt-4o',
  models: []
};

describe('makeLlm.complete', () => {
  it('resolves role "fanout" to fanoutModel and returns text', async () => {
    const fakeGenerate = vi.fn().mockResolvedValue({ text: 'hi' });
    const llm = makeLlm(cfg, { generate: fakeGenerate, provider: (id: string) => ({ id }) as any });
    const out = await llm.complete({ role: 'fanout', system: 'S', prompt: 'P' });
    expect(out).toBe('hi');
    const arg = fakeGenerate.mock.calls[0][0];
    expect(arg.model.id).toBe('gpt-4o-mini');
    expect(arg.system).toBe('S');
    expect(arg.prompt).toBe('P');
  });

  it('honors an explicit model override over the role default', async () => {
    const fakeGenerate = vi.fn().mockResolvedValue({ text: 'ok' });
    const llm = makeLlm(cfg, { generate: fakeGenerate, provider: (id: string) => ({ id }) as any });
    await llm.complete({ role: 'synth', model: 'o4-mini', prompt: 'x' });
    expect(fakeGenerate.mock.calls[0][0].model.id).toBe('o4-mini');
  });
});

describe('makeLlm.stream', () => {
  it('resolves role "synth" to synthModel and returns the textStream', () => {
    const textStream = (async function* () { yield 'a'; })();
    const fakeStream = vi.fn().mockReturnValue({ textStream });
    const llm = makeLlm(cfg, { stream: fakeStream as any, provider: (id: string) => ({ id }) as any });
    const out = llm.stream({ role: 'synth', prompt: 'P' });
    expect(fakeStream.mock.calls[0][0].model.id).toBe('gpt-4o');
    expect(fakeStream.mock.calls[0][0].prompt).toBe('P');
    expect(out).toBe(textStream);
  });
});
