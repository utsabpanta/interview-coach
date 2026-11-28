import { OpenAICompatLLM } from "../../../src/openai.js";
import type { LLM } from "../../../src/types.js";
import { BrowserLLM } from "./llm.js";
import type { ProviderId, Settings } from "./types.js";

export interface Provider {
  label: string;
  /** Shown beside the name in the picker. */
  tag: string;
  /** OpenAI-compatible API root; empty for Anthropic, which has its own client. */
  baseUrl: string;
  /** A starting point only: model names change, so the dialog can load the live list. */
  defaultModel: string;
  needsKey: boolean;
  keyUrl?: string;
  note: string;
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  groq: {
    label: "Groq",
    tag: "free tier, open models",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    needsKey: true,
    keyUrl: "https://console.groq.com/keys",
    note: "Fast hosted open models with a free tier and no credit card. Daily limits apply.",
  },
  gemini: {
    label: "Google Gemini",
    tag: "free tier",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-3.5-flash",
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
    note: "Free tier on selected models through Google AI Studio.",
  },
  openrouter: {
    label: "OpenRouter",
    tag: "free models",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    needsKey: true,
    keyUrl: "https://openrouter.ai/keys",
    note: "Many open models; the ones ending in :free cost nothing but have a low daily request cap, which one full interview can use up.",
  },
  ollama: {
    label: "Ollama",
    tag: "local, private",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    needsKey: false,
    note: "Runs open models on your own computer, so the job posting and your answers are not sent to a model provider. Speech is still transcribed by your browser.",
  },
  anthropic: {
    label: "Anthropic Claude",
    tag: "paid",
    baseUrl: "",
    defaultModel: "claude-sonnet-5-5",
    needsKey: true,
    keyUrl: "https://console.anthropic.com/",
    note: "Paid API. No free tier.",
  },
  custom: {
    label: "Other (OpenAI-compatible)",
    tag: "any server",
    baseUrl: "",
    defaultModel: "",
    needsKey: false,
    note: "Any server that speaks the OpenAI chat completions API, such as LM Studio, vLLM, or another hosted provider.",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function activeModel(s: Settings): string {
  return (s.models[s.provider] ?? "").trim() || PROVIDERS[s.provider].defaultModel;
}

export function activeBaseUrl(s: Settings): string {
  return (s.baseUrls[s.provider] ?? "").trim() || PROVIDERS[s.provider].baseUrl;
}

export function activeKey(s: Settings): string {
  return (s.keys[s.provider] ?? "").trim();
}

/** What is still missing before the chosen provider can be called, or null if ready. */
export function missing(s: Settings): string | null {
  const p = PROVIDERS[s.provider];
  if (p.needsKey && !activeKey(s)) return `Add your ${p.label} API key to start.`;
  if (s.provider !== "anthropic" && !activeBaseUrl(s)) return "Enter the server address to start.";
  if (!activeModel(s)) return "Enter a model name to start.";
  return null;
}

export function makeLLM(s: Settings): LLM | null {
  if (missing(s)) return null;
  if (s.provider === "anthropic") return new BrowserLLM(activeKey(s), activeModel(s));
  return new OpenAICompatLLM({ baseUrl: activeBaseUrl(s), apiKey: activeKey(s) || undefined, model: activeModel(s) });
}
