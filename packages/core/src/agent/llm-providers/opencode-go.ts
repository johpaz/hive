import { OpenAICompatBase } from "./openai-compat-base"

export class OpenCodeGoProvider extends OpenAICompatBase {
  static readonly secretKey = "OPENCODE_GO_API_KEY"

  constructor() {
    super("opencode-go")
  }
}
