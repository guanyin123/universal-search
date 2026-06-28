import type { AppConfig, LlmRuntimeConfig } from '../config';
import type { Channel } from './types';

type ActiveSource = { getActiveChannel(): Channel | null };

/**
 * Resolve the effective LLM config from (in order): the active channel, then the env
 * fallback. Throws a clear, user-facing error when neither yields a usable config.
 *
 * Pure — takes the store and the env `llm` block as args so it stays out of the
 * `$env/dynamic/private` graph and is unit-testable. The runtime wrapper lives in
 * `./index` (`resolveLlmConfig`).
 */
export function resolveLlmConfigFrom(
  store: ActiveSource,
  envLlm: AppConfig['llm']
): LlmRuntimeConfig {
  const active = store.getActiveChannel();
  if (active && active.baseURL && active.apiKey) {
    const fanout = active.fanoutModel || active.models[0] || envLlm.fanoutModel || '';
    const synth = active.synthModel || active.models[0] || envLlm.synthModel || '';
    if (fanout && synth) {
      return {
        baseURL: active.baseURL,
        apiKey: active.apiKey,
        fanoutModel: fanout,
        synthModel: synth,
        models: active.models
      };
    }
  }

  if (envLlm.baseURL && envLlm.apiKey && envLlm.fanoutModel && envLlm.synthModel) {
    return {
      baseURL: envLlm.baseURL,
      apiKey: envLlm.apiKey,
      fanoutModel: envLlm.fanoutModel,
      synthModel: envLlm.synthModel,
      models: envLlm.models
    };
  }

  throw new Error(
    '尚未配置 AI 渠道：请在「设置 → 管理渠道」中添加一个渠道（base_url + 密钥 + 模型）。'
  );
}
