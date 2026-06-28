/** The bits of an LLM config `listModels` needs (a resolved channel or env). */
export type ModelSource = { baseURL: string; apiKey: string; models: string[] };

/** List selectable model ids. Tries the provider's OpenAI-compatible /models, falls back to cfg.models. */
export async function listModels(
  cfg: ModelSource,
  fetchFn: typeof fetch = fetch
): Promise<string[]> {
  try {
    const res = await fetchFn(`${cfg.baseURL.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` }
    });
    if (!res.ok) {
      console.warn(`[listModels] provider /models returned ${res.status}; falling back to configured models`);
      return cfg.models;
    }
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = (body.data ?? []).map((m) => m.id).filter(Boolean);
    return ids.length ? ids : cfg.models;
  } catch (err) {
    console.warn('[listModels] falling back to configured models:', err instanceof Error ? err.message : err);
    return cfg.models;
  }
}
