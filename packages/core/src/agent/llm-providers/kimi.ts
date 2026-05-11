import { OpenAICompatBase } from "./openai-compat-base"

export class KimiProvider extends OpenAICompatBase {
  constructor() { super("kimi") }

  /** Kimi K2 thinking mode returns reasoning_content that must be round-tripped. */
  protected needsReasoningRoundtrip(): boolean { return true }
}
