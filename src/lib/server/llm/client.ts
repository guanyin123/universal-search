import { generateText, streamText, type LanguageModel } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LlmRuntimeConfig } from '../config';

type LlmConfig = LlmRuntimeConfig;
export type Role = 'fanout' | 'synth';

export interface CompleteArgs {
  role: Role;
  model?: string;
  system?: string;
  prompt: string;
}

interface Deps {
  generate: typeof generateText;
  stream: typeof streamText;
  provider: (modelId: string) => LanguageModel;
}

export function makeLlm(cfg: LlmConfig, deps?: Partial<Deps>) {
  const provider =
    deps?.provider ??
    createOpenAICompatible({ name: 'llm', baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  const generateFn = deps?.generate ?? generateText;
  const streamFn = deps?.stream ?? streamText;

  const resolve = (role: Role, override?: string) =>
    override ?? (role === 'fanout' ? cfg.fanoutModel : cfg.synthModel);

  return {
    async complete(args: CompleteArgs): Promise<string> {
      const { text } = await generateFn({
        model: provider(resolve(args.role, args.model)),
        system: args.system,
        prompt: args.prompt
      });
      return text;
    },
    stream(args: CompleteArgs) {
      const result = streamFn({
        model: provider(resolve(args.role, args.model)),
        system: args.system,
        prompt: args.prompt
      });
      return result.textStream;
    }
  };
}

export type Llm = ReturnType<typeof makeLlm>;
