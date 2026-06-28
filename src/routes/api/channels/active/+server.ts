import { json, error } from '@sveltejs/kit';
import { getSettings } from '$lib/server/settings';

/** POST { id } → set the active channel. */
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const id = (body.id ?? '').toString();
  if (!id) throw error(400, 'id is required');
  const s = getSettings();
  if (!s.setActive(id)) throw error(404, `channel not found: ${id}`);
  return json({ activeId: s.getActiveId() });
}
