import { generateText, streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { AppConfig } from '../config';

type LlmConfig = AppConfig['llm'];
export type Role = 'fanout' | 'synth';

export interface CompleteArgs {
  role: Role;
  model?: string;
  system?: string;
  prompt: string;
}

interface Deps {
  generate: typeof generateText;
  provider: (modelId: string) => any;
}

export function makeLlm(cfg: LlmConfig, deps?: Partial<Deps>) {
  const provider =
    deps?.provider ??
    createOpenAICompatible({ name: 'llm', baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  const generate = deps?.generate ?? generateText;

  const resolve = (role: Role, override?: string) =>
    override ?? (role === 'fanout' ? cfg.fanoutModel : cfg.synthModel);

  return {
    async complete(args: CompleteArgs): Promise<string> {
      const { text } = await generate({
        model: provider(resolve(args.role, args.model)),
        system: args.system,
        prompt: args.prompt
      });
      return text;
    },
    stream(args: CompleteArgs) {
      const result = streamText({
        model: provider(resolve(args.role, args.model)),
        system: args.system,
        prompt: args.prompt
      });
      return result.textStream;
    }
  };
}

export type Llm = ReturnType<typeof makeLlm>;
