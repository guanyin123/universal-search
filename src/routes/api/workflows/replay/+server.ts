import { json, error } from '@sveltejs/kit';
import { getConfig } from '$lib/server/runtime-config';
import { resolveLlmConfig } from '$lib/server/settings';
import { realDeps } from '$lib/server/runs/deps';
import { bus } from '$lib/server/events';
import { hydrateReplay, runPlan, runGithubSearch } from '$lib/server/runs/machine';
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

  // resolveLlmConfig()/realDeps() throw when no channel (or env fallback) exists.
  let llm, deps;
  try {
    llm = resolveLlmConfig();
    deps = realDeps();
  } catch (e) {
    throw error(503, e instanceof Error ? e.message : 'AI 渠道未配置');
  }
  const models = {
    fanout: body.fanoutModel || workflow.modelConfig.fanout || llm.fanoutModel,
    synth: body.synthModel || workflow.modelConfig.synth || llm.synthModel
  };
  const run = await hydrateReplay(workflow, { question, models }, deps);
  // Kick off the tail async (dispatched on the workflow's mode); the client watches over SSE.
  if ((workflow.mode ?? 'report') === 'github') {
    runGithubSearch(run.id, run.plan, deps, bus).catch(() => {});
  } else {
    runPlan(run.id, run.plan, deps, bus, { buildSynthPrompt: makeWorkflowSynthPrompt(workflow) }).catch(() => {});
  }
  return json({ id: run.id, status: run.status, mode: run.mode, plan: run.plan });
}
