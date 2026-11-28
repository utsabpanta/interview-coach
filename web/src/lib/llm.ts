import Anthropic from "@anthropic-ai/sdk";
import type { LLM, ToolSpec } from "../../../src/types.js";

/**
 * Calls the Claude API straight from the browser with the visitor's own key.
 * There is no server in between: the key is sent only to Anthropic.
 */
export class BrowserLLM implements LLM {
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  }

  async text(system: string, user: string, maxTokens = 2000): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    return res.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
  }

  async structured<T>(system: string, user: string, tool: ToolSpec, maxTokens = 2000): Promise<T> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema as Anthropic.Tool.InputSchema }],
      tool_choice: { type: "tool", name: tool.name },
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("The model returned no structured result.");
    return block.input as T;
  }
}

/** Turns an API failure into a sentence a visitor can act on. */
export function explainError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  const detail = err instanceof Error ? err.message : "";
  if (/on-device model/i.test(detail)) {
    return `${detail} Check your connection and that this computer has a recent graphics chip, or choose another provider in Settings.`;
  }
  if (status === 401) return "The model provider rejected the API key. Check it in Settings.";
  if (status === 403) return "This API key is not allowed to use the selected model. Check the key or the model in Settings.";
  if (status === 404) return "The model provider does not recognize the model name. Pick another in Settings.";
  if (status === 429) return "The model provider's rate limit or daily free quota was reached. Wait a while, or switch provider in Settings.";
  if (status && status >= 500) return "The model provider had a problem. Try again in a moment.";
  if (/could not reach/i.test(detail)) return `${detail} Check the address and your connection; for a local server, see the setup note in Settings.`;
  if (/fetch|network|connection/i.test(detail)) return "Could not reach the model provider. Check your connection and try again.";
  return detail || "Something went wrong. Try again.";
}
