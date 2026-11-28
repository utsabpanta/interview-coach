import { describe, expect, it } from "vitest";
import type { Feedback } from "../src/coach.js";
import { detectIntent, pauseBeforeReply, stripSignOff } from "../src/intents.js";
import type { LLM, ToolSpec } from "../src/types.js";
import { runMock, type IO } from "../src/mock.js";

describe("detectIntent", () => {
  it.each([
    "Can you repeat the question?",
    "can you repeat the question",
    "Could you please repeat that?",
    "Sorry, can you say that again?",
    "repeat the question please",
    "Um, could you ask that again",
    "What was the question?",
    "Sorry, what was the question again?",
    "I didn't catch that",
    "Sorry, I didn't quite hear the question",
    "One more time, please",
    "Come again?",
    "Sorry?",
    "Pardon?",
    "Wait, can you repeat it?",
  ])("hears a request to repeat: %s", (text) => {
    expect(detectIntent(text)).toBe("repeat");
  });

  it.each([
    "I had to repeat that migration twice before it worked.",
    "We asked the question again in the retro and I changed the plan.",
    "Sorry, what I meant was that I led the rollback.",
    "I said it again to leadership the next week.",
    "My team would repeat the question of ownership every sprint, so I wrote it down and assigned owners myself, which finally settled it.",
    "",
  ])("does not mistake an answer for a request: %s", (text) => {
    expect(detectIntent(text)).not.toBe("repeat");
  });

  it("hears a spoken sign-off and removes it from the answer", () => {
    expect(detectIntent("I shipped it in six weeks. That's my answer.")).toBe("done");
    expect(detectIntent("So I rolled it back and I'm done")).toBe("done");
    expect(detectIntent("That's all the context I have, and then I rewrote it.")).toBeNull();
    expect(stripSignOff("I shipped it in six weeks. That's my answer.")).toBe("I shipped it in six weeks.");
    expect(stripSignOff("I shipped it.")).toBe("I shipped it.");
  });
});

describe("pauseBeforeReply", () => {
  it("answers requests and short questions quickly, and gives answers room to think", () => {
    const quick = pauseBeforeReply("Can you repeat the question?");
    expect(pauseBeforeReply("What scale should I assume?")).toBe(quick);
    expect(pauseBeforeReply("I shipped it. That's my answer.")).toBe(quick);
    expect(pauseBeforeReply("So the first thing I did was look at the dashboards")).toBeGreaterThan(quick * 2);
  });
});

describe("the terminal interview listens too", () => {
  const FEEDBACK: Feedback = { scores: { structure: 4, specificity: 4, relevance: 4, concision: 4 }, strengths: [], improvements: ["x"], rewrite: "r" };

  it("repeats the question on request and does not count clarifications as turns", async () => {
    const calls: string[] = [];
    const replies = [
      { reply: "Put simply: what did you build, and what was your part?", move_on: false, candidate_asked_only: true },
      { reply: "And the result?", move_on: false, candidate_asked_only: false },
      { reply: "Thanks.", move_on: true, candidate_asked_only: false },
    ];
    const llm: LLM = {
      async text() {
        return "";
      },
      async structured<T>(_s: string, _u: string, tool: ToolSpec): Promise<T> {
        calls.push(tool.name);
        if (tool.name === "interview_plan") return { role: "Engineer", intro: "", questions: [{ question: "Tell me about a recent project.", competency: "ownership" }] } as T;
        if (tool.name === "interviewer_reply") return replies.shift() as T;
        return FEEDBACK as T;
      },
    };
    const said: string[] = [];
    const answers = ["Can you repeat the question?", "Could you rephrase that?", "I rebuilt billing and led it.", "We shipped in six weeks."];
    const io: IO = { say: (t) => void said.push(t), ask: async () => answers.shift() ?? null };

    const session = await runMock(llm, io, { type: "behavioral" }, { count: 1, followUps: true });

    // The repeat was handled without a model call; the question was said twice.
    expect(said.filter((t) => t.includes("Tell me about a recent project.")).length).toBe(2);
    expect(calls).toEqual(["interview_plan", "interviewer_reply", "interviewer_reply", "interviewer_reply", "answer_feedback"]);
    const [round] = session.rounds;
    expect(round.exchanges.map((e) => Boolean(e.aside))).toEqual([true, false, false]);
    // Delivery metrics ignore the clarification.
    expect(round.metrics.words).toBe(11);
  });
});
