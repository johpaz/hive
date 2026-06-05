import { OpenAICompatBase } from "./openai-compat-base"

export class MiniMaxProvider extends OpenAICompatBase {
  static readonly secretKey = "MINIMAX_API_KEY"

  constructor() {
    super("minimax")
  }

  protected needsReasoningRoundtrip(): boolean {
    return true
  }
}
