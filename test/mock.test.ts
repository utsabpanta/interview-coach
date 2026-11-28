import { describe, expect, it } from "vitest";
import type { Feedback } from "../src/coach.js";
import type { LLM, ToolSpec } from "../src/llm.js";
import { runMock, type IO } from "../src/mock.js";
import { overallScore, renderSession } from "../src/session.js";

const FEEDBACK: Feedback = {
  scores: { structure: 4, specificity: 3, relevance: 5, concision: 4 },
  strengths: ["Clear result."],
  improvements: ["Add a number."],
  rewrite: "I cut latency by [metric].",
};

function fakeLLM(): LLM & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async text() {
      return "";
    },
    async structured<T>(_system: string, _user: string, tool: ToolSpec): Promise<T> {
      calls.push(tool.name);
      if (tool.name === "interviewer_reply") return { reply: "What was your own role?", move_on: false } as T;
      if (tool.name === "interview_plan") {
        return {
          questions: [
            { question: "Tell me about a failure.", competency: "failure" },
            { question: "Tell me about a conflict.", competency: "conflict" },
            { question: "Tell me about ambiguity.", competency: "ambiguity" },
          ],
        } as T;
      }
      return FEEDBACK as T;
    },
  };
}

function scriptedIO(answers: Array<string | null>): IO & { output: string[] } {
  const output: string[] = [];
  let i = 0;
  return {
    output,
    say: (text) => void output.push(text),
    ask: async () => (i < answers.length ? answers[i++] : null),
  };
}

const ctx = { type: "behavioral" as const };

describe("runMock", () => {
  it("holds a back-and-forth, evaluates, and records each round", async () => {
    const llm = fakeLLM();
    const io = scriptedIO(["I broke prod and fixed it.", "I led the rollback.", "/skip", "/quit"]);
    const session = await runMock(llm, io, ctx, { count: 3, followUps: true });

    expect(session.rounds).toHaveLength(1);
    expect(session.rounds[0].exchanges).toHaveLength(2);
    expect(session.rounds[0].competency).toBe("failure");
    expect(llm.calls).toEqual(["interview_plan", "interviewer_reply", "interviewer_reply", "answer_feedback"]);
    expect(overallScore(session)).toBe(4);
  });

  it("skips follow-ups when disabled and stops when input ends", async () => {
    const llm = fakeLLM();
    const io = scriptedIO(["Answer one.", "Answer two."]);
    const session = await runMock(llm, io, ctx, { count: 3, followUps: false });

    expect(session.rounds).toHaveLength(2);
    expect(llm.calls).not.toContain("interviewer_reply");
  });

  it("renders a Markdown transcript", async () => {
    const io = scriptedIO(["Answer one.", "My role was lead."]);
    const session = await runMock(fakeLLM(), io, ctx, { count: 1, followUps: true });
    const md = renderSession(session);

    expect(md).toContain("# Mock interview: behavioral");
    expect(md).toContain("**Interviewer:** Tell me about a failure.");
    expect(md).toContain("**Follow-up:** What was your own role?");
    expect(md).toContain("Score: 4/5");
  });
});
