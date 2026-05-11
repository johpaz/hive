import { OpenAICompatBase } from "./openai-compat-base"

export class NvidiaProvider extends OpenAICompatBase {
  constructor() { super("nvidia") }
}
