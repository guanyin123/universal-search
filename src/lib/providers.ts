/**
 * Curated, offline preset list of well-known OpenAI-compatible AI providers, for the
 * "管理 AI 渠道" quick-add gallery. Base URLs are calibrated to the full version path
 * the LLM client needs (it calls `${baseURL}/models` and `${baseURL}/chat/completions`
 * via @ai-sdk/openai-compatible). Model ids are conveniences — 「测试连接」 fetches the
 * authoritative list from the provider. Anthropic is intentionally absent: its native
 * API (/v1/messages) is NOT OpenAI-compatible.
 *
 * Base URLs / provider set verified against models.dev (the open-source AI-model DB).
 * The offline snapshot matches this project's anti-poisoning / offline ethos; refresh
 * the list by hand when a provider's endpoint changes.
 */
export interface ProviderPreset {
  /** Stable slug — also the logo filename under `static/providers/{id}.svg`. */
  id: string;
  /** Display name. */
  name: string;
  /** Full OpenAI-compatible base URL (includes the `/v1`-style version path). */
  baseURL: string;
  /** Short monogram shown when the logo image is missing (offline fallback). */
  short: string;
  /** Brand-ish tint for the monogram fallback + card accent. */
  color: string;
  /** Where to get an API key. */
  docsUrl?: string;
  /** Placeholder for the key field. */
  keyHint?: string;
  /** Local providers (e.g. Ollama) need no real key — prefill a dummy so save passes. */
  noKey?: boolean;
  /** A few recognizable model ids (conveniences; 「测试连接」 auto-fills the real list). */
  models: string[];
  /** Suggested cheap "铺广度" model. */
  fanout?: string;
  /** Suggested strong "收口" model. */
  synth?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    short: 'AI',
    color: '#10a37f',
    docsUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-...',
    models: ['gpt-4o', 'gpt-4o-mini', 'o4-mini'],
    fanout: 'gpt-4o-mini',
    synth: 'gpt-4o'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    short: 'DS',
    color: '#4d6bfe',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk-...',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    fanout: 'deepseek-chat',
    synth: 'deepseek-reasoner'
  },
  {
    id: 'moonshot',
    name: 'Kimi (Moonshot)',
    baseURL: 'https://api.moonshot.cn/v1',
    short: 'KM',
    color: '#111827',
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
    keyHint: 'sk-...（国际站用 api.moonshot.ai）',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    fanout: 'moonshot-v1-8k',
    synth: 'moonshot-v1-128k'
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    short: 'GLM',
    color: '#3859ff',
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
    fanout: 'glm-4-flash',
    synth: 'glm-4-plus'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    short: 'OR',
    color: '#6467f2',
    docsUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-...',
    models: ['openai/gpt-4o-mini', 'deepseek/deepseek-chat', 'anthropic/claude-3.5-sonnet'],
    fanout: 'openai/gpt-4o-mini',
    synth: 'anthropic/claude-3.5-sonnet'
  },
  {
    id: 'groq',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    short: 'GQ',
    color: '#f55036',
    docsUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_...',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    fanout: 'llama-3.1-8b-instant',
    synth: 'llama-3.3-70b-versatile'
  },
  {
    id: 'together',
    name: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    short: 'TG',
    color: '#0f6fff',
    docsUrl: 'https://api.together.xyz/settings/api-keys',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
      'Qwen/Qwen2.5-72B-Instruct-Turbo'
    ],
    fanout: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    synth: 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseURL: 'https://api.mistral.ai/v1',
    short: 'MS',
    color: '#fa520f',
    docsUrl: 'https://console.mistral.ai/api-keys',
    models: ['mistral-small-latest', 'mistral-large-latest', 'open-mistral-nemo'],
    fanout: 'mistral-small-latest',
    synth: 'mistral-large-latest'
  },
  {
    id: 'google',
    name: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    short: 'GM',
    color: '#4285f4',
    docsUrl: 'https://aistudio.google.com/apikey',
    models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    fanout: 'gemini-1.5-flash',
    synth: 'gemini-1.5-pro'
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    baseURL: 'https://api.x.ai/v1',
    short: 'XA',
    color: '#111827',
    docsUrl: 'https://console.x.ai',
    keyHint: 'xai-...',
    models: ['grok-2-latest', 'grok-2-mini'],
    fanout: 'grok-2-mini',
    synth: 'grok-2-latest'
  },
  {
    id: 'alibaba',
    name: '通义千问 Qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    short: 'QW',
    color: '#615ced',
    docsUrl: 'https://bailian.console.aliyun.com/',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    fanout: 'qwen-turbo',
    synth: 'qwen-max'
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    baseURL: 'https://api.siliconflow.cn/v1',
    short: 'SF',
    color: '#7c3aed',
    docsUrl: 'https://cloud.siliconflow.cn/account/ak',
    keyHint: 'sk-...',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    fanout: 'Qwen/Qwen2.5-7B-Instruct',
    synth: 'deepseek-ai/DeepSeek-V3'
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseURL: 'http://localhost:11434/v1',
    short: 'OL',
    color: '#111827',
    docsUrl: 'https://ollama.com',
    keyHint: '本地无需密钥',
    noKey: true,
    models: ['llama3.2', 'llama3.1', 'qwen2.5', 'mistral'],
    fanout: 'llama3.2',
    synth: 'llama3.1'
  }
];
