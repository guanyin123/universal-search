import { json } from '@sveltejs/kit';
import { resolveLlmConfig } from '$lib/server/settings';
import { listModels } from '$lib/server/llm/models';

export async function GET() {
  let llm;
  try {
    llm = resolveLlmConfig();
  } catch {
    // No active channel and no env fallback — tell the UI to prompt for setup
    // instead of erroring out.
    return json({ models: [], defaults: { fanout: '', synth: '' }, baseURL: '', needsSetup: true });
  }
  const models = await listModels(llm);
  return json({
    models,
    defaults: { fanout: llm.fanoutModel, synth: llm.synthModel },
    baseURL: llm.baseURL,
    needsSetup: false
  });
}
