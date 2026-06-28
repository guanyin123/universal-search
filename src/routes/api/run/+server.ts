import { json, error } from '@sveltejs/kit';
import { resolveLlmConfig } from '$lib/server/settings';
import { realDeps } from '$lib/server/runs/deps';
import { bus } from '$lib/server/events';
import { startRun } from '$lib/server/runs/machine';

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const question = (body.question ?? '').toString().trim();
  if (!question) throw error(400, 'question is required');
  const mode = body.mode === 'github' ? 'github' : 'report';

  // resolveLlmConfig()/realDeps() throw when no channel (or env fallback) is configured.
  // Surface that as an `error` status so the UI shows the message instead of a raw 500.
  let llm, deps;
  try {
    llm = resolveLlmConfig();
    deps = realDeps();
  } catch (e) {
    return json({
      id: '',
      status: 'error',
      mode,
      plan: null,
      error: e instanceof Error ? e.message : 'AI 渠道未配置'
    });
  }

  const run = await startRun(
    {
      question,
      models: {
        fanout: body.fanoutModel || llm.fanoutModel,
        synth: body.synthModel || llm.synthModel
      }
    },
    deps,
    bus,
    mode
  );
  // include error so the UI can show WHY proposing failed — that error event fires
  // during this POST, before the client's SSE connects, so it'd otherwise be lost.
  return json({ id: run.id, status: run.status, mode: run.mode, plan: run.plan, error: run.error?.message ?? null });
}
