import type { LLM, ToolSpec } from "./types.js";

/**
 * A client for any OpenAI-compatible chat API: Groq, OpenRouter, Google Gemini's
 * compatibility endpoint, Ollama, LM Studio, and others. Uses only `fetch`, so it
 * runs in the browser and in Node.
 */

export interface OpenAIOptions {
  /** API root, for example https://api.groq.com/openai/v1 */
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ function?: { arguments?: string | object } }>;
    };
  }>;
}

// Reasoning models spend output tokens on thinking before they answer.
const MIN_TOKENS = 2000;

const trimSlash = (url: string) => url.replace(/\/+$/, "");

function headers(apiKey?: string): Record<string, string> {
  return { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
}

async function failure(res: Response): Promise<ProviderError> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; message?: string };
    detail = (typeof body.error === "string" ? body.error : body.error?.message) ?? body.message ?? "";
  } catch {
    // No readable body.
  }
  return new ProviderError(detail || `The model provider returned an error (${res.status}).`, res.status);
}

/** Some local models wrap their reasoning in <think> tags; it is not part of the answer. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** Pulls the first JSON object out of a model reply that may have prose or code fences around it. */
export function extractJson(text: string): unknown {
  const cleaned = stripThinking(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new ProviderError("The model did not return the structured result that was asked for.");
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new ProviderError("The model returned a malformed structured result. Try again, or pick a larger model.");
  }
}

export class OpenAICompatLLM implements LLM {
  private fetchImpl: typeof fetch;

  constructor(private opts: OpenAIOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private async chat(body: Record<string, unknown>): Promise<ChatResponse> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${trimSlash(this.opts.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: headers(this.opts.apiKey),
        body: JSON.stringify({ model: this.opts.model, ...body }),
      });
    } catch {
      throw new ProviderError(`Could not reach the model provider at ${this.opts.baseUrl}.`);
    }
    if (!res.ok) throw await failure(res);
    return (await res.json()) as ChatResponse;
  }

  async text(system: string, user: string, maxTokens = 2000): Promise<string> {
    const res = await this.chat({
      max_tokens: Math.max(maxTokens, MIN_TOKENS),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    return stripThinking(res.choices?.[0]?.message?.content ?? "");
  }

  /**
   * Asks for a forced tool call. Models and servers that do not support that
   * get a second request asking for plain JSON instead.
   */
  async structured<T>(system: string, user: string, tool: ToolSpec, maxTokens = 2000): Promise<T> {
    const max_tokens = Math.max(maxTokens, MIN_TOKENS);
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    try {
      const res = await this.chat({
        max_tokens,
        messages,
        tools: [{ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.schema } }],
        tool_choice: { type: "function", function: { name: tool.name } },
      });
      const message = res.choices?.[0]?.message;
      const args = message?.tool_calls?.[0]?.function?.arguments;
      if (args && typeof args === "object") return args as T;
      if (typeof args === "string" && args.trim()) return extractJson(args) as T;
      if (message?.content) {
        try {
          return extractJson(message.content) as T;
        } catch {
          // Fall through to the JSON request.
        }
      }
    } catch (err) {
      // 400-class errors here usually mean "tools are not supported"; anything else is real.
      const status = err instanceof ProviderError ? err.status : undefined;
      if (status === undefined || ![400, 404, 422, 501].includes(status)) throw err;
    }

    const res = await this.chat({
      max_tokens,
      messages: [
        { role: "system", content: `${system}\n\nReply with a single JSON object and nothing else.` },
        {
          role: "user",
          content: `${user}\n\nReturn one JSON object (${tool.description}) that matches this JSON Schema:\n${JSON.stringify(tool.schema)}`,
        },
      ],
    });
    return extractJson(res.choices?.[0]?.message?.content ?? "") as T;
  }
}

/** Model IDs the server offers, for a model picker. */
export async function listModels(opts: Omit<OpenAIOptions, "model">): Promise<string[]> {
  const doFetch = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  let res: Response;
  try {
    res = await doFetch(`${trimSlash(opts.baseUrl)}/models`, { headers: headers(opts.apiKey) });
  } catch {
    throw new ProviderError(`Could not reach the model provider at ${opts.baseUrl}.`);
  }
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? [])
    .map((m) => m.id ?? "")
    .filter(Boolean)
    .map((id) => id.replace(/^models\//, ""))
    .sort();
}
