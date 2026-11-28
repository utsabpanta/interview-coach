import { extractJson, ProviderError, stripThinking } from "../../../src/openai.js";
import type { LLM, ToolSpec } from "../../../src/types.js";

/**
 * A model that runs inside the browser on the visitor's own graphics chip,
 * through WebLLM. It needs no API key and sends nothing to a model provider.
 *
 * It is experimental: the first use downloads a few gigabytes, it needs WebGPU,
 * and small models give rougher questions and feedback than hosted ones.
 * The library is loaded only when this provider is chosen.
 */

export const ON_DEVICE_MODELS: Array<{ id: string; label: string }> = [
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B: about 2 GB, works on most recent laptops" },
  { id: "Phi-4-mini-instruct-q4f16_1-MLC", label: "Phi-4 mini: about 3.5 GB, better feedback" },
  { id: "Llama-3.1-8B-Instruct-q4f16_1-MLC", label: "Llama 3.1 8B: about 5 GB, best feedback, needs a strong graphics card" },
];

export interface LoadProgress {
  /** 0 to 1. */
  progress: number;
  text: string;
}

type Listener = (p: LoadProgress | null) => void;
const listeners = new Set<Listener>();
let latest: LoadProgress | null = null;

function report(p: LoadProgress | null): void {
  latest = p;
  for (const l of listeners) l(p);
}

/** Follows the model download; called with null when nothing is loading. */
export function onLoadProgress(listener: Listener): () => void {
  listeners.add(listener);
  listener(latest);
  return () => void listeners.delete(listener);
}

export function onDeviceSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

// The slice of WebLLM's engine this file uses.
interface Engine {
  chat: {
    completions: {
      create(request: {
        messages: Array<{ role: "system" | "user"; content: string }>;
        max_tokens?: number;
        temperature?: number;
        response_format?: { type: "json_object"; schema?: string };
      }): Promise<{ choices: Array<{ message: { content?: string | null } }> }>;
    };
  };
}

// One loaded model is shared by everything on the page; loading it is the slow part.
let loaded: { id: string; engine: Promise<Engine> } | null = null;

function loadEngine(modelId: string): Promise<Engine> {
  if (loaded?.id === modelId) return loaded.engine;
  if (!onDeviceSupported()) {
    return Promise.reject(
      new ProviderError("This browser cannot run a model on your device, because WebGPU is not available. Use a recent Chrome or Edge on a computer, or choose another provider in Settings."),
    );
  }
  report({ progress: 0, text: "Starting" });
  const engine = import("@mlc-ai/web-llm")
    .then((webllm) =>
      webllm.CreateMLCEngine(modelId, {
        initProgressCallback: (r) => report({ progress: r.progress, text: r.text }),
      }),
    )
    .then((e) => {
      report(null);
      return e as unknown as Engine;
    })
    .catch((err: unknown) => {
      report(null);
      loaded = null;
      const detail = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`The on-device model could not be loaded. ${detail}`);
    });
  loaded = { id: modelId, engine };
  return engine;
}

export class OnDeviceLLM implements LLM {
  constructor(private modelId: string) {}

  private async ask(system: string, user: string, maxTokens: number, schema?: string): Promise<string> {
    const engine = await loadEngine(this.modelId);
    const res = await engine.chat.completions.create({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.6,
      ...(schema === undefined ? {} : { response_format: schema ? { type: "json_object", schema } : { type: "json_object" } }),
    });
    return res.choices[0]?.message?.content ?? "";
  }

  async text(system: string, user: string, maxTokens = 2000): Promise<string> {
    return stripThinking(await this.ask(system, user, maxTokens));
  }

  /**
   * Structured output through grammar-constrained JSON. If the model library
   * rejects the schema, falls back to plain JSON with the schema in the prompt.
   */
  async structured<T>(system: string, user: string, tool: ToolSpec, maxTokens = 2000): Promise<T> {
    const schema = JSON.stringify(tool.schema);
    const jsonSystem = `${system}\n\nReply with a single JSON object and nothing else.`;
    const jsonUser = `${user}\n\nReturn one JSON object (${tool.description}) that matches this JSON Schema:\n${schema}`;
    let content: string;
    try {
      content = await this.ask(jsonSystem, jsonUser, maxTokens, schema);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      content = await this.ask(jsonSystem, jsonUser, maxTokens, "");
    }
    return extractJson(content) as T;
  }
}
