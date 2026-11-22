import Anthropic from "@anthropic-ai/sdk";

/** A structured-output request: the model must reply by filling in this schema. */
export interface ToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

/** The only surface the coach needs from a model. Tests supply a fake. */
export interface LLM {
  text(system: string, user: string, maxTokens?: number): Promise<string>;
  structured<T>(system: string, user: string, tool: ToolSpec, maxTokens?: number): Promise<T>;
}

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export class AnthropicLLM implements LLM {
  private client: Anthropic;
  private model: string;

  constructor(model = process.env.COACH_MODEL ?? DEFAULT_MODEL) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set. Export it before running the coach.");
    }
    this.client = new Anthropic();
    this.model = model;
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
      tools: [
        {
          name: tool.name,
          description: tool.description,
          input_schema: tool.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: tool.name },
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new Error(`Model did not return structured output for ${tool.name}.`);
    }
    return block.input as T;
  }
}
