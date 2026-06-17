import { json } from '@sveltejs/kit';
import { getConfig } from '$lib/server/runtime-config';
import { listModels } from '$lib/server/llm/models';

export async function GET() {
  const cfg = getConfig();
  const models = await listModels(cfg.llm);
  return json({
    models,
    defaults: { fanout: cfg.llm.fanoutModel, synth: cfg.llm.synthModel }
  });
}
