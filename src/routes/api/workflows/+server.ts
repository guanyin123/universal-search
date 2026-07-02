import { json, error } from '@sveltejs/kit';
import { getSaveDir } from '$lib/server/settings';
import { realDeps } from '$lib/server/runs/deps';
import { buildWorkflowDoc } from '$lib/server/workflows/build';
import { listWorkflows, saveWorkflow, deleteWorkflow } from '$lib/server/workflows/store';

export async function GET() {
  return json({ workflows: await listWorkflows(getSaveDir()) });
}

/** Delete a saved workflow by slug (or id): DELETE /api/workflows?slug=... */
export async function DELETE({ url }) {
  const slug = (url.searchParams.get('slug') ?? '').trim();
  if (!slug) throw error(400, 'slug is required');
  const removed = await deleteWorkflow(getSaveDir(), slug);
  if (!removed) throw error(404, `workflow not found: ${slug}`);
  return json({ ok: true });
}

/** Save a finished run as a reusable workflow. */
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const runId = (body.runId ?? '').toString();
  if (!runId) throw error(400, 'runId is required');

  const deps = realDeps();
  const run = await deps.store.get(runId);
  if (!run) throw error(404, `run not found: ${runId}`);
  if (run.status !== 'awaiting_deposit' && run.status !== 'done') {
    throw error(409, `run ${runId} is not finished (status: ${run.status})`);
  }

  const doc = buildWorkflowDoc(run, { name: body.name?.toString().trim() || undefined });
  try {
    const { path } = await saveWorkflow(deps.vaultRoot, doc);
    return json({ id: doc.id, name: doc.name, path });
  } catch (e) {
    // Unconfigured save dir / path failure — surface the reason so the UI can show it.
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
