import { describe, expect, it } from "vitest";
import type { Feedback } from "../src/coach.js";
import { detectIntent, PATIENCE_MS, pauseBeforeReply, stripSignOff } from "../src/intents.js";
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
    "Pardon?",
    "Wait, can you repeat it?",
    "I'm sorry, can you repeat the question",
    "Yeah can you repeat the question",
    "Actually, can you repeat the question?",
    "Can I hear the question again?",
    "Would you mind repeating that?",
    "Please repeat",
    "sorry what was that",
    "What?",
    "could you repeat the last part",
  ])("hears a request to repeat: %s", (text) => {
    expect(detectIntent(text)).toBe("repeat");
  });

  // Each of these once threw a real answer away.
  it.each([
    "I didn't get that promotion, so I changed teams",
    "I didn't catch that bug until production",
    "I couldn't get it to reproduce locally",
    "Say it was a Tuesday and the pager went off",
    "Ask the team what changed, then roll it back",
    "Repeat that process for every shard",
    "Once more, the root cause was a missing index",
    "Sorry",
    "I had to repeat that migration twice before it worked.",
    "We asked the question again in the retro and I changed the plan.",
    "Sorry, what I meant was that I led the rollback.",
    "I said it again to leadership the next week.",
    "What I did was pause the migration",
    "I didn't hear that the deploy had failed",
    "",
  ])("does not mistake an answer for a request: %s", (text) => {
    expect(detectIntent(text)).not.toBe("repeat");
  });

  it.each(["Could you say that again but slower", "Would you ask that differently", "Can you repeat the question in simpler terms"])(
    "leaves a request to rephrase for the interviewer: %s",
    (text) => {
      expect(detectIntent(text)).toBeNull();
    },
  );

  it("honors an unmistakable sign-off and removes only that", () => {
    expect(detectIntent("I shipped it in six weeks. That's my answer.")).toBe("done");
    expect(stripSignOff("I shipped it in six weeks. That's my answer.")).toBe("I shipped it in six weeks.");
    expect(stripSignOff("We rolled back and that's all I have")).toBe("We rolled back");
    expect(detectIntent("It took a month that's pretty much it")).toBe("done");
    expect(detectIntent("I shipped it I think that covers it")).toBe("done");
    expect(stripSignOff("I shipped it.")).toBe("I shipped it.");
  });

  it("honors a short sign-off only when it was said on its own", () => {
    expect(detectIntent("I shipped it in six weeks that's it", "that's it")).toBe("done");
    expect(stripSignOff("I shipped it in six weeks that's it", "that's it")).toBe("I shipped it in six weeks");
    expect(detectIntent("So I rolled it back I'm done", "I'm done")).toBe("done");
  });

  // Each of these once had its ending cut off.
  it.each([
    "I told him if this happens again I'm done",
    "I asked what would unblock them and he said that's it",
    "After six months of that I'm done",
    "The root cause? A missing index, that's all",
    "That's all the context I have, and then I rewrote it.",
  ])("does not cut the end off a story: %s", (text) => {
    expect(detectIntent(text)).toBeNull();
    expect(detectIntent(text, text)).toBeNull();
    expect(stripSignOff(text)).toBe(text);
  });
});

describe("pauseBeforeReply", () => {
  const quick = pauseBeforeReply("Can you repeat the question?");

  it("answers requests and short questions quickly", () => {
    expect(quick).toBeLessThan(2000);
    expect(pauseBeforeReply("What scale should I assume?")).toBe(quick);
    expect(pauseBeforeReply("I shipped it. That's my answer.")).toBe(quick);
  });

  it("gives an answer room to think, and more when it is clearly unfinished", () => {
    const finished = pauseBeforeReply("I rebuilt the billing pipeline and shipped it in six weeks");
    expect(finished).toBe(PATIENCE_MS.normal);
    expect(finished).toBeGreaterThanOrEqual(5000);
    // Stopped mid-sentence.
    expect(pauseBeforeReply("I rebuilt the billing pipeline and")).toBeGreaterThan(finished);
    // Barely started.
    expect(pauseBeforeReply("So um")).toBeGreaterThan(pauseBeforeReply("I rebuilt the billing pipeline and"));
  });

  it("follows the patience setting", () => {
    const text = "I rebuilt the billing pipeline and shipped it in six weeks";
    expect(pauseBeforeReply(text, PATIENCE_MS.short)).toBe(PATIENCE_MS.short);
    expect(pauseBeforeReply(text, PATIENCE_MS.long)).toBe(PATIENCE_MS.long);
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
