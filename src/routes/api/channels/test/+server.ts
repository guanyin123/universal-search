import { json, error } from '@sveltejs/kit';
import { getSettings } from '$lib/server/settings';

/**
 * POST { baseURL, apiKey, id? } → probe the provider's OpenAI-compatible `/models`
 * to verify connectivity and return the live model list. When editing an existing
 * channel the key field may be blank (masked) — pass `id` to reuse the stored key.
 * Always returns 200 with `{ ok, models, error? }` so the UI can render the verdict.
 */
export async function POST({ request, fetch }) {
  const body = await request.json().catch(() => ({}));
  let baseURL = (body.baseURL ?? '').toString().trim();
  let apiKey = (body.apiKey ?? '').toString().trim();
  const id = (body.id ?? '').toString().trim();

  if (id && !apiKey) {
    const stored = getSettings().get(id);
    if (stored) {
      apiKey = stored.apiKey;
      baseURL = baseURL || stored.baseURL;
    }
  }
  if (!baseURL) throw error(400, 'baseURL is required');
  if (!apiKey) throw error(400, 'apiKey is required');

  try {
    const res = await fetch(`${baseURL.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      return json({ ok: false, models: [], error: `HTTP ${res.status}${detail ? `: ${detail}` : ''}` });
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const models = (data.data ?? []).map((m) => m.id).filter(Boolean);
    return json({ ok: true, models });
  } catch (e) {
    return json({ ok: false, models: [], error: e instanceof Error ? e.message : '连接失败' });
  }
}
