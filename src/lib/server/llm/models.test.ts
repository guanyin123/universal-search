import { describe, it, expect, vi } from 'vitest';
import { listModels } from './models';

const cfg = { baseURL: 'https://api.openai.com/v1', apiKey: 'sk', fanoutModel: 'a', synthModel: 'b', models: ['fallback-1'] };

describe('listModels', () => {
  it('returns model ids from the provider /models endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] })
    });
    const ids = await listModels(cfg, fetchFn as any);
    expect(ids).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(fetchFn).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer sk' })
    }));
  });

  it('falls back to cfg.models when the endpoint errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const ids = await listModels(cfg, fetchFn as any);
    expect(ids).toEqual(['fallback-1']);
  });

  it('falls back when fetch throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network'));
    const ids = await listModels(cfg, fetchFn as any);
    expect(ids).toEqual(['fallback-1']);
  });
});
