import { beforeEach, describe, expect, it } from "vitest";
import { OpenAICompatLLM } from "../../src/openai.js";
import { BrowserLLM } from "../src/lib/llm.js";
import { activeBaseUrl, activeModel, makeLLM, missing, PROVIDER_IDS, PROVIDERS } from "../src/lib/providers.js";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../src/lib/store.js";
import type { Settings } from "../src/lib/types.js";

const settings = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, keys: {}, models: {}, baseUrls: {}, ...over });

describe("providers", () => {
  it("defines a usable preset for every provider", () => {
    for (const id of PROVIDER_IDS) {
      const p = PROVIDERS[id];
      expect(p.label && p.note).toBeTruthy();
      if (id !== "anthropic" && id !== "custom") expect(p.baseUrl).toMatch(/^https?:\/\/.+\/v1/);
      if (p.needsKey) expect(p.keyUrl).toMatch(/^https:\/\//);
    }
  });

  it("says what is missing before a provider can be used", () => {
    expect(missing(settings({ provider: "groq" }))).toBe("Add your Groq API key to start.");
    expect(missing(settings({ provider: "groq", keys: { groq: "k" } }))).toBeNull();
    expect(missing(settings({ provider: "ollama" }))).toBeNull();
    expect(missing(settings({ provider: "custom" }))).toBe("Enter the server address to start.");
    expect(missing(settings({ provider: "custom", baseUrls: { custom: "http://localhost:1234/v1" } }))).toBe("Enter a model name to start.");
    expect(missing(settings({ provider: "custom", baseUrls: { custom: "http://localhost:1234/v1" }, models: { custom: "m" } }))).toBeNull();
  });

  it("uses overrides when set and presets otherwise", () => {
    const s = settings({ provider: "ollama", models: { ollama: " qwen3 " }, baseUrls: { ollama: "http://box:11434/v1" } });
    expect(activeModel(s)).toBe("qwen3");
    expect(activeBaseUrl(s)).toBe("http://box:11434/v1");
    expect(activeModel(settings({ provider: "ollama" }))).toBe(PROVIDERS.ollama.defaultModel);
  });

  it("builds the right client", () => {
    expect(makeLLM(settings({ provider: "groq" }))).toBeNull();
    expect(makeLLM(settings({ provider: "groq", keys: { groq: "k" } }))).toBeInstanceOf(OpenAICompatLLM);
    expect(makeLLM(settings({ provider: "ollama" }))).toBeInstanceOf(OpenAICompatLLM);
    expect(makeLLM(settings({ provider: "anthropic", keys: { anthropic: "k" } }))).toBeInstanceOf(BrowserLLM);
  });
});

describe("settings storage", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  });

  it("defaults to a free provider", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(PROVIDERS[DEFAULT_SETTINGS.provider].tag).toContain("free");
  });

  it("migrates settings saved before providers existed", () => {
    localStorage.setItem("callback.settings.v1", JSON.stringify({ apiKey: "sk-old", model: "claude-x", speakQuestions: false, followUps: true }));
    const s = loadSettings();
    expect(s).toMatchObject({ provider: "anthropic", keys: { anthropic: "sk-old" }, models: { anthropic: "claude-x" }, speakQuestions: false });
    expect(s).not.toHaveProperty("apiKey");
  });

  it("round-trips and repairs an unknown provider", () => {
    saveSettings(settings({ provider: "gemini", keys: { gemini: "g" } }));
    expect(loadSettings()).toMatchObject({ provider: "gemini", keys: { gemini: "g" } });
    localStorage.setItem("callback.settings.v1", JSON.stringify({ provider: "nope" }));
    expect(loadSettings().provider).toBe("groq");
  });
});
