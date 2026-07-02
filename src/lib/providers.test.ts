import { describe, it, expect } from 'vitest';
import { PROVIDER_PRESETS } from './providers';

describe('PROVIDER_PRESETS', () => {
  it('has unique ids and required display fields', () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROVIDER_PRESETS) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.name.trim().length).toBeGreaterThan(0);
      expect(p.short.trim().length).toBeGreaterThan(0);
      expect(p.color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });

  it('base URLs are http(s), carry a version path, and never end in a slash', () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.baseURL, p.id).toMatch(/^https?:\/\//);
      expect(p.baseURL.endsWith('/'), p.id).toBe(false);
      // The LLM client appends `/models` + `/chat/completions`, so the base must
      // already include the provider's version path (…/v1, …/paas/v4, …/openai).
      expect(new URL(p.baseURL).pathname.length, p.id).toBeGreaterThan(1);
    }
    // only the local provider may use plain http
    for (const p of PROVIDER_PRESETS) {
      if (p.baseURL.startsWith('http://')) expect(p.baseURL).toContain('localhost');
    }
  });

  it('suggested fanout/synth models, when set, appear in the convenience model list', () => {
    for (const p of PROVIDER_PRESETS) {
      if (p.fanout) expect(p.models, `${p.id} fanout`).toContain(p.fanout);
      if (p.synth) expect(p.models, `${p.id} synth`).toContain(p.synth);
    }
  });
});
