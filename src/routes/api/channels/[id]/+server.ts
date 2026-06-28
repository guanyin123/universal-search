import { json, error } from '@sveltejs/kit';
import { getSettings } from '$lib/server/settings';

function toModels(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map((m) => String(m).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((m) => m.trim()).filter(Boolean);
  return undefined;
}

/** PUT → update a channel. An omitted/empty apiKey keeps the stored key. */
export async function PUT({ params, request }) {
  const body = await request.json().catch(() => ({}));
  const s = getSettings();
  const updated = s.update(params.id, {
    name: body.name?.toString().trim() || undefined,
    baseURL: body.baseURL?.toString().trim() || undefined,
    apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
    models: toModels(body.models),
    fanoutModel: body.fanoutModel?.toString().trim() || undefined,
    synthModel: body.synthModel?.toString().trim() || undefined
  });
  if (!updated) throw error(404, `channel not found: ${params.id}`);
  return json({ channel: updated, activeId: s.getActiveId() });
}

/** DELETE → remove a channel; active is reassigned to a remaining one (or cleared). */
export async function DELETE({ params }) {
  const s = getSettings();
  if (!s.remove(params.id)) throw error(404, `channel not found: ${params.id}`);
  return json({ ok: true, activeId: s.getActiveId() });
}
