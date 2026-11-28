import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate, interviewerTurn, normalizeFeedback, planInterview, validatePack, type QuestionPack } from "../src/coach.js";
import type { LLM, ToolSpec } from "../src/types.js";

const dir = path.join(import.meta.dirname, "..", "packs");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

function capture(reply: unknown) {
  const prompts: Record<string, string> = {};
  const llm: LLM = {
    async text() {
      return "";
    },
    async structured<T>(_s: string, user: string, tool: ToolSpec): Promise<T> {
      prompts[tool.name] = user;
      return reply as T;
    },
  };
  return { llm, prompts };
}

describe("question packs", () => {
  it("ships at least a few", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  // Every contributed pack is checked here, so a broken one fails CI before it is merged.
  it.each(files)("%s is valid", (file) => {
    const pack = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as QuestionPack;
    expect(validatePack(pack)).toEqual([]);
    expect(`${pack.id}.json`).toBe(file);
    expect(new Set(pack.examples).size).toBe(pack.examples.length);
  });

  it("explains what is wrong with a bad pack", () => {
    expect(validatePack({ id: "Bad Id", name: "x", description: "short", types: ["chat"], guidance: "too short", examples: ["one"] })).toEqual([
      '"id" must be lowercase words joined by hyphens',
      '"name" must be text of at least 3 characters',
      '"description" must be text of at least 10 characters',
      '"guidance" must be text of at least 80 characters',
      '"types" must list one or more of: behavioral, technical, system-design',
      '"examples" must be 3 to 12 questions of 15 to 400 characters each',
    ]);
    expect(validatePack(null).length).toBeGreaterThan(0);
  });

  it("gives the interviewer the pack's guidance as style, not as a script", async () => {
    const pack = JSON.parse(readFileSync(path.join(dir, "backend-engineer.json"), "utf8")) as QuestionPack;
    const { llm, prompts } = capture({ role: "Backend Engineer", intro: "", questions: [{ question: "Q?", competency: "debugging" }] });
    await planInterview(llm, { type: "technical", pack }, 1);
    expect(prompts.interview_plan).toContain("Guidance for this kind of role (Backend engineer)");
    expect(prompts.interview_plan).toContain(pack.guidance);
    expect(prompts.interview_plan).toContain("Write your own; do not reuse these");
  });
});

describe("the shared notes pad", () => {
  const exchanges = [{ question: "Design a rate limiter.", answer: "I'd use a token bucket, see my notes." }];
  const topic = { question: "Design a rate limiter.", competency: "trade-offs" };

  it("is shown to the interviewer and the evaluator as part of the answer", async () => {
    const ctx = { type: "system-design" as const, workspace: "client -> gateway -> redis (token bucket per key)" };
    const turn = capture({ reply: "What happens when Redis is down?", move_on: false, candidate_asked_only: false });
    await interviewerTurn(turn.llm, ctx, topic, exchanges, 3);
    expect(turn.prompts.interviewer_reply).toContain("<candidate_notes>\nclient -> gateway -> redis (token bucket per key)\n</candidate_notes>");

    const scored = capture({ scores: { structure: 4, specificity: 4, relevance: 4, concision: 4 }, improvements: ["x"] });
    await evaluate(scored.llm, ctx, exchanges, undefined, undefined, topic);
    expect(scored.prompts.answer_feedback).toContain("Treat it as part of what they have told you.");
  });

  it("is left out when empty", async () => {
    const turn = capture({ reply: "And then?", move_on: false, candidate_asked_only: false });
    await interviewerTurn(turn.llm, { type: "system-design", workspace: "   " }, topic, exchanges, 3);
    expect(turn.prompts.interviewer_reply).not.toContain("candidate_notes");
  });
});

describe("coaching points", () => {
  const scores = { structure: 4, specificity: 3, relevance: 4, concision: 4 };

  it("keeps well-formed points and drops the rest", () => {
    const f = normalizeFeedback({
      scores,
      notes: [
        { quote: "we decided to pause", note: "Say who decided." },
        { quote: "", note: "No quote." },
        { quote: "shipped six weeks later" },
        "junk",
        { quote: "I led the rollout", note: "Strong: this is your own action." },
        { quote: "a", note: "b" },
        { quote: "c", note: "d" },
        { quote: "e", note: "f" },
      ],
    });
    expect(f.notes).toEqual([
      { quote: "we decided to pause", note: "Say who decided." },
      { quote: "I led the rollout", note: "Strong: this is your own action." },
      { quote: "a", note: "b" },
      { quote: "c", note: "d" },
    ]);
  });

  it("is absent when the model gives none", () => {
    expect(normalizeFeedback({ scores }).notes).toBeUndefined();
  });
});
