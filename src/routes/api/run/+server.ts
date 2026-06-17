import { json, error } from '@sveltejs/kit';
import { getConfig } from '$lib/server/runtime-config';
import { realDeps } from '$lib/server/runs/deps';
import { bus } from '$lib/server/events';
import { startRun } from '$lib/server/runs/machine';

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const question = (body.question ?? '').toString().trim();
  if (!question) throw error(400, 'question is required');

  const cfg = getConfig();
  const run = await startRun(
    {
      question,
      models: {
        fanout: body.fanoutModel || cfg.llm.fanoutModel,
        synth: body.synthModel || cfg.llm.synthModel
      }
    },
    realDeps(),
    bus
  );
  // include error so the UI can show WHY proposing failed — that error event fires
  // during this POST, before the client's SSE connects, so it'd otherwise be lost.
  return json({ id: run.id, status: run.status, plan: run.plan, error: run.error?.message ?? null });
}
