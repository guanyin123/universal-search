import { json, error } from '@sveltejs/kit';
import { getConfig } from '$lib/server/runtime-config';
import { realDeps } from '$lib/server/runs/deps';
import { bus } from '$lib/server/events';
import { hydrateReplay, runPlan } from '$lib/server/runs/machine';
import { loadWorkflow } from '$lib/server/workflows/store';
import { makeWorkflowSynthPrompt } from '$lib/server/workflows/build';

/** Replay a stored workflow against a new question — skips propose + awaiting_edit. */
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const slug = (body.workflow ?? '').toString();
  const question = (body.question ?? '').toString().trim();
  if (!slug) throw error(400, 'workflow is required');
  if (!question) throw error(400, 'question is required');

  const cfg = getConfig();
  const workflow = await loadWorkflow(cfg.vaultRoot, slug);
  if (!workflow) throw error(404, `workflow not found: ${slug}`);

  const deps = realDeps();
  const models = {
    fanout: body.fanoutModel || workflow.modelConfig.fanout || cfg.llm.fanoutModel,
    synth: body.synthModel || workflow.modelConfig.synth || cfg.llm.synthModel
  };
  const run = await hydrateReplay(workflow, { question, models }, deps);
  // Kick off the search→synth→deposit chain async; the client watches over SSE.
  runPlan(run.id, run.plan, deps, bus, { buildSynthPrompt: makeWorkflowSynthPrompt(workflow) }).catch(() => {});
  return json({ id: run.id, status: run.status, plan: run.plan });
}
