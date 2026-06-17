import { json } from '@sveltejs/kit';
import { realDeps } from '$lib/server/runs/deps';
import { bus } from '$lib/server/events';
import { depositRun } from '$lib/server/runs/deposit';

export async function POST({ params }) {
  depositRun(params.id, realDeps(), bus).catch(() => {});
  return json({ ok: true });
}
