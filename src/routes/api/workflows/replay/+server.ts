import { json, error } from '@sveltejs/kit';
import { resolveLlmConfig, getSaveDir } from '$lib/server/settings';
import { realDeps } from '$lib/server/runs/deps';
import { hydrateReplay } from '$lib/server/runs/machine';
import { loadWorkflow } from '$lib/server/workflows/store';
import { workflowQuestion } from '$lib/server/workflows/build';

/**
 * Prepare an editable run from a stored workflow: hydrate its saved plan + last
 * question into a run parked at `awaiting_edit`, WITHOUT starting the search. The client
 * fills the question box + renders the pre-filled plan; the user reviews and clicks
 * 开始搜索 (→ POST /api/run/[id]/plan) to actually run.
 */
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const slug = (body.workflow ?? '').toString();
  if (!slug) throw error(400, 'workflow is required');

  const workflow = await loadWorkflow(getSaveDir(), slug);
  if (!workflow) throw error(404, `workflow not found: ${slug}`);

  // Default to the workflow's saved last question; allow an explicit override.
  const question = (body.question ?? '').toString().trim() || workflowQuestion(workflow);

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
  const run = await hydrateReplay(workflow, { question, models }, deps, { status: 'awaiting_edit' });
  return json({ id: run.id, status: run.status, mode: run.mode, plan: run.plan, question: run.question });
}
