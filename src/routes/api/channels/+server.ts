import { json, error } from '@sveltejs/kit';
import { getSettings } from '$lib/server/settings';

/** GET → all channels (public shape, no plaintext keys) + the active id. */
export async function GET() {
  const s = getSettings();
  return json({ channels: s.list(), activeId: s.getActiveId() });
}

/** Coerce a models field that may arrive as an array or a comma-separated string. */
function toModels(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((m) => String(m).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((m) => m.trim()).filter(Boolean);
  return [];
}

/** POST → create a channel. The first channel created becomes active automatically. */
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const name = (body.name ?? '').toString().trim();
  const baseURL = (body.baseURL ?? '').toString().trim();
  const apiKey = (body.apiKey ?? '').toString().trim();
  if (!name) throw error(400, 'name is required');
  if (!baseURL) throw error(400, 'baseURL is required');
  if (!apiKey) throw error(400, 'apiKey is required');

  const s = getSettings();
  const channel = s.create({
    name,
    baseURL,
    apiKey,
    models: toModels(body.models),
    fanoutModel: body.fanoutModel?.toString().trim() || undefined,
    synthModel: body.synthModel?.toString().trim() || undefined
  });
  return json({ channel, activeId: s.getActiveId() });
}
