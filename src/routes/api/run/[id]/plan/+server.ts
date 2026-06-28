import { json, error } from '@sveltejs/kit';
import { realDeps } from '$lib/server/runs/deps';
import { bus } from '$lib/server/events';
import { runPlan, runGithubSearch } from '$lib/server/runs/machine';

export async function POST({ params, request }) {
  const body = await request.json().catch(() => ({}));
  if (!body.plan?.dimensions) throw error(400, 'plan.dimensions required');
  // Kick off async; the client watches progress over SSE. Dispatch on the run's mode
  // (the source of truth) so github runs take the ranked-repos tail, not runPlan.
  const deps = realDeps();
  const run = await deps.store.get(params.id);
  if (run?.mode === 'github') runGithubSearch(params.id, body.plan, deps, bus).catch(() => {});
  else runPlan(params.id, body.plan, deps, bus).catch(() => {});
  return json({ ok: true });
}
