import { json, error } from '@sveltejs/kit';
import { realDeps } from '$lib/server/runs/deps';
import { bus } from '$lib/server/events';
import { runPlan } from '$lib/server/runs/machine';

export async function POST({ params, request }) {
  const body = await request.json().catch(() => ({}));
  if (!body.plan?.dimensions) throw error(400, 'plan.dimensions required');
  // Kick off async; the client watches progress over SSE.
  runPlan(params.id, body.plan, realDeps(), bus).catch(() => {});
  return json({ ok: true });
}
