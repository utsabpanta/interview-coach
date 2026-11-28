import { describe, expect, it } from "vitest";
import { EvaluationError, normalizeFeedback, normalizePlan } from "../src/coach.js";
import { extractJson, listModels, OpenAICompatLLM, ProviderError, retryDelay, stripThinking } from "../src/openai.js";

const TOOL = { name: "answer_feedback", description: "Record feedback.", schema: { type: "object" } };

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

/** A fetch stand-in that replays canned responses and records what was sent. */
function fakeFetch(responses: Array<{ status?: number; json: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(next.json), { status: next.status ?? 200, headers: next.headers });
  }) as typeof fetch;
  return { impl, calls };
}

const reply = (message: Record<string, unknown>) => ({ json: { choices: [{ message }] } });

describe("OpenAICompatLLM", () => {
  it("sends a chat request and strips model reasoning from text", async () => {
    const { impl, calls } = fakeFetch([reply({ content: "<think>hmm</think>\nWhat was your role?" })]);
    const llm = new OpenAICompatLLM({ baseUrl: "https://api.example.com/v1/", apiKey: "k", model: "m", fetchImpl: impl });

    expect(await llm.text("sys", "user", 300)).toBe("What was your role?");
    expect(calls[0].url).toBe("https://api.example.com/v1/chat/completions");
    expect(calls[0].headers.Authorization).toBe("Bearer k");
    expect(calls[0].body).toMatchObject({ model: "m", max_tokens: 2000, messages: [{ role: "system", content: "sys" }, { role: "user", content: "user" }] });
  });

  it("omits the Authorization header without a key", async () => {
    const { impl, calls } = fakeFetch([reply({ content: "ok" })]);
    await new OpenAICompatLLM({ baseUrl: "http://localhost:11434/v1", model: "m", fetchImpl: impl }).text("s", "u");
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("reads structured output from a forced tool call", async () => {
    const { impl, calls } = fakeFetch([reply({ tool_calls: [{ function: { arguments: '{"a":1}' } }] })]);
    const llm = new OpenAICompatLLM({ baseUrl: "https://x/v1", model: "m", fetchImpl: impl });

    expect(await llm.structured("s", "u", TOOL)).toEqual({ a: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.tool_choice).toEqual({ type: "function", function: { name: "answer_feedback" } });
    expect(calls[0].body.tools[0].function.parameters).toEqual({ type: "object" });
  });

  it("accepts JSON in the message when the model ignores the tool", async () => {
    const { impl, calls } = fakeFetch([reply({ content: 'Sure!\n```json\n{"a": 2}\n```' })]);
    expect(await new OpenAICompatLLM({ baseUrl: "https://x/v1", model: "m", fetchImpl: impl }).structured("s", "u", TOOL)).toEqual({ a: 2 });
    expect(calls).toHaveLength(1);
  });

  it("falls back to a plain JSON request when tools are unsupported", async () => {
    const { impl, calls } = fakeFetch([
      { status: 400, json: { error: { message: "model does not support tools" } } },
      reply({ content: '{"a":3}' }),
    ]);
    expect(await new OpenAICompatLLM({ baseUrl: "https://x/v1", model: "m", fetchImpl: impl }).structured("s", "u", TOOL)).toEqual({ a: 3 });
    expect(calls).toHaveLength(2);
    expect(calls[1].body.tools).toBeUndefined();
    expect(calls[1].body.messages[1].content).toContain('{"type":"object"}');
  });

  it("does not retry on authentication errors", async () => {
    const { impl, calls } = fakeFetch([{ status: 401, json: { error: { message: "nope" } } }]);
    const llm = new OpenAICompatLLM({ baseUrl: "https://x/v1", model: "m", fetchImpl: impl });
    await expect(llm.structured("s", "u", TOOL)).rejects.toMatchObject({ status: 401, message: "nope" });
    expect(calls).toHaveLength(1);
  });

  describe("when the provider says to slow down", () => {
    const limited = (message: string, headers: Record<string, string> = {}) => ({ status: 429, json: { error: { message } }, headers });

    function setup(responses: Parameters<typeof fakeFetch>[0]) {
      const { impl, calls } = fakeFetch(responses);
      const slept: number[] = [];
      const waits: number[] = [];
      const llm = new OpenAICompatLLM({
        baseUrl: "https://x/v1",
        model: "m",
        fetchImpl: impl,
        sleep: async (ms) => void slept.push(ms),
        onWait: (seconds) => void waits.push(seconds),
      });
      return { llm, calls, slept, waits };
    }

    it("waits as long as it was told to, then carries on", async () => {
      const { llm, calls, slept, waits } = setup([
        limited("Rate limit reached for model m on tokens per minute (TPM). Please try again in 7.66s."),
        limited("Slow down.", { "retry-after": "2" }),
        reply({ content: "And then?" }),
      ]);
      expect(await llm.text("s", "u")).toBe("And then?");
      expect(calls).toHaveLength(3);
      expect(slept).toEqual([7910, 2250]);
      expect(waits).toEqual([8, 3]);
    });

    it("gives up on a daily quota at once, with the provider's message", async () => {
      const { llm, calls, slept } = setup([limited("Rate limit reached: requests per day (RPD) exceeded. Daily quota exhausted.")]);
      await expect(llm.text("s", "u")).rejects.toMatchObject({ status: 429 });
      expect(calls).toHaveLength(1);
      expect(slept).toEqual([]);
    });

    it("does not hang on a wait of minutes", async () => {
      const { llm, calls } = setup([limited("Please try again in 6m12s.")]);
      await expect(llm.text("s", "u")).rejects.toMatchObject({ status: 429 });
      expect(calls).toHaveLength(1);
    });

    it("stops after a few attempts if the limit never lifts", async () => {
      const { llm, calls } = setup([limited("Too many requests.")]);
      await expect(llm.text("s", "u")).rejects.toMatchObject({ status: 429 });
      expect(calls).toHaveLength(5);
    });

    it("reads the wait from a header or the message", () => {
      const res = (h: Record<string, string> = {}) => ({ headers: { get: (k: string) => h[k] ?? null } });
      expect(retryDelay(res({ "retry-after": "3" }), "")).toBe(3250);
      expect(retryDelay(res(), "Please try again in 840ms.")).toBe(1090);
      expect(retryDelay(res(), "Please try again in 1m2s.")).toBeNull();
      expect(retryDelay(res(), "no hint")).toBe(5250);
      expect(retryDelay(res(), "You exceeded your current quota, please check your plan and billing details.")).toBeNull();
    });
  });

  it("reports an unreachable server by address", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const llm = new OpenAICompatLLM({ baseUrl: "http://localhost:11434/v1", model: "m", fetchImpl: impl });
    await expect(llm.text("s", "u")).rejects.toThrow("Could not reach the model provider at http://localhost:11434/v1.");
  });

  it("lists models", async () => {
    const { impl, calls } = fakeFetch([{ json: { data: [{ id: "zeta" }, { id: "models/alpha" }, {}] } }]);
    expect(await listModels({ baseUrl: "https://x/v1", apiKey: "k", fetchImpl: impl })).toEqual(["alpha", "zeta"]);
    expect(calls[0].url).toBe("https://x/v1/models");
  });
});

describe("extractJson", () => {
  it("handles fences, prose, and reasoning tags", () => {
    expect(extractJson('<think>{"no":1}</think> Here: {"yes": {"n": 1}} done')).toEqual({ yes: { n: 1 } });
    expect(stripThinking("<think>a</think>b")).toBe("b");
  });

  it("rejects replies without valid JSON", () => {
    expect(() => extractJson("no json here")).toThrow(ProviderError);
    expect(() => extractJson("{broken")).toThrow(ProviderError);
    expect(() => extractJson("{'a': 1}")).toThrow(/malformed/);
  });
});

describe("normalizing model output", () => {
  it("tidies wording but keeps the model's own scores", () => {
    const f = normalizeFeedback({
      scores: { structure: "4", specificity: 5, relevance: 1, concision: 2.6 },
      strengths: "Clear opening.",
      improvements: ["Add a number.", "", 7, "Name your role.", "Cut the intro.", "A fourth."],
      rewrite: 42,
      fix: { detail: "Because." },
    });
    expect(f.scores).toEqual({ structure: 4, specificity: 5, relevance: 1, concision: 3 });
    expect(f.strengths).toEqual(["Clear opening."]);
    expect(f.improvements).toEqual(["Add a number.", "Name your role.", "Cut the intro."]);
    expect(f.rewrite).toBe("");
    // With no headline, the top improvement becomes the fix.
    expect(f.fix).toEqual({ headline: "Add a number.", detail: "Because." });
    expect(f.changes).toBeUndefined();
  });

  it("finds scores inside a tool-call envelope", () => {
    const scores = { structure: 2, specificity: 2, relevance: 2, concision: 2 };
    expect(normalizeFeedback({ name: "answer_feedback", arguments: { scores, improvements: ["x"] } }).scores).toEqual(scores);
    expect(normalizeFeedback({ input: { scores } }).scores).toEqual(scores);
  });

  // A made-up score looks exactly like a real one, so none is ever invented.
  it.each([
    ["an empty object", {}],
    ["a refusal", { error: "I cannot evaluate this." }],
    ["text instead of an object", "not an object"],
    ["a missing score", { scores: { structure: 4, specificity: 4, relevance: 4 } }],
    ["a ten-point scale", { scores: { structure: 7, specificity: 6, relevance: 8, concision: 10 } }],
    ["a zero", { scores: { structure: 0, specificity: 3, relevance: 3, concision: 3 } }],
    ["words for numbers", { scores: { structure: "great", specificity: 3, relevance: 3, concision: 3 } }],
    ["a fraction as text", { scores: { structure: "4/5", specificity: 3, relevance: 3, concision: 3 } }],
    ["nulls", { scores: { structure: null, specificity: null, relevance: null, concision: null } }],
  ])("refuses to score %s", (_name, raw) => {
    expect(() => normalizeFeedback(raw)).toThrow(EvaluationError);
  });

  it("cleans up a plan", () => {
    const plan = normalizePlan(
      { role: "  ", questions: [{ question: " Q1? ", competency: "Conflict" }, { question: "" }, { question: "Q2?", competency: "grit" }, { question: "Q3?" }, "junk"] },
      { type: "behavioral" },
      3,
    );
    expect(plan).toEqual({
      role: "General practice",
      intro: "",
      questions: [
        { question: "Q1?", competency: "conflict" },
        { question: "Q2?", competency: "grit" },
        { question: "Q3?", competency: "general" },
      ],
    });
    expect(normalizePlan({ questions: [{ question: "Q?", competency: "x" }] }, { type: "behavioral", focusCompetency: "failure" }, 5).questions[0].competency).toBe("failure");
    expect(normalizePlan(null, { type: "technical" }, 5)).toEqual({ role: "General practice", intro: "", questions: [] });
  });
});
