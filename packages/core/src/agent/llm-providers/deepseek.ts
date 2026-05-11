import { OpenAICompatBase } from "./openai-compat-base"

export class DeepSeekProvider extends OpenAICompatBase {
  constructor() { super("deepseek") }

  /** DeepSeek reasoner models return reasoning_content that must be round-tripped. */
  protected needsReasoningRoundtrip(): boolean { return true }
}
