import { describe, expect, it } from "vitest";
import { clip, closingTopic, COMPETENCIES, evaluate, interviewerTurn, planInterview, ROUND_SHAPE, type PlannedQuestion } from "../src/coach.js";
import type { LLM, ToolSpec } from "../src/types.js";

/** Records prompts and replays canned structured replies by tool name. */
function scripted(replies: Record<string, unknown>) {
  const prompts: Record<string, string> = {};
  const llm: LLM = {
    async text() {
      return "";
    },
    async structured<T>(_system: string, user: string, tool: ToolSpec): Promise<T> {
      prompts[tool.name] = user;
      return replies[tool.name] as T;
    },
  };
  return { llm, prompts };
}

const topic: PlannedQuestion = { question: "Tell me about a recent project.", competency: "ownership" };
const exchanges = [{ question: topic.question, answer: "We rebuilt billing. What scale should I assume?" }];
const FEEDBACK = { scores: { structure: 4, specificity: 4, relevance: 4, concision: 4 }, strengths: [], improvements: ["x"], rewrite: "r" };

describe("interviewerTurn", () => {
  it("continues the conversation and shows the model the transcript", async () => {
    const { llm, prompts } = scripted({ interviewer_reply: { reply: " Let's say a million users. What was your part? ", move_on: false } });
    const turn = await interviewerTurn(llm, { type: "behavioral" }, topic, exchanges, 2);

    expect(turn).toEqual({ reply: "Let's say a million users. What was your part?", done: false, aside: false });
    expect(prompts.interviewer_reply).toContain("Interviewer: Tell me about a recent project.\nCandidate: We rebuilt billing. What scale should I assume?");
    expect(prompts.interviewer_reply).toContain("answer it directly first");
    expect(prompts.interviewer_reply).toContain("after your reply: 2.");
  });

  it("ends the topic when the model says so, when turns run out, or when the reply is empty", async () => {
    const ctx = { type: "behavioral" as const };
    expect((await interviewerTurn(scripted({ interviewer_reply: { reply: "Thanks.", move_on: true } }).llm, ctx, topic, exchanges, 2)).done).toBe(true);
    expect((await interviewerTurn(scripted({ interviewer_reply: { reply: "And then?", move_on: false } }).llm, ctx, topic, exchanges, 0)).done).toBe(true);
    expect(await interviewerTurn(scripted({ interviewer_reply: {} }).llm, ctx, topic, exchanges, 2)).toEqual({ reply: "", done: true, aside: false });
  });

  it("treats a request to repeat or rephrase as an aside, even on the last turn", async () => {
    const { llm, prompts } = scripted({ interviewer_reply: { reply: "Sure. Which project of yours are you proudest of?", move_on: false, candidate_asked_only: true } });
    const asked = [{ question: topic.question, answer: "Sorry, could you rephrase that?" }];
    const turn = await interviewerTurn(llm, { type: "behavioral" }, topic, asked, 0);

    expect(turn).toEqual({ reply: "Sure. Which project of yours are you proudest of?", done: false, aside: true });
    expect(prompts.interviewer_reply).toContain("If the candidate asked you to repeat the question, say it again.");
    expect(prompts.interviewer_reply).toContain("The first thing you asked on this topic was: Tell me about a recent project.");
    expect(prompts.interviewer_reply).not.toContain("never a question you already asked");
  });

  it("answers the candidate's questions in the closing part", async () => {
    const { llm, prompts } = scripted({ interviewer_reply: { reply: "The team is six people. What else?", move_on: false } });
    await interviewerTurn(llm, { type: "behavioral" }, closingTopic(), [{ question: closingTopic().question, answer: "How big is the team?" }], 2);
    expect(prompts.interviewer_reply).toContain("the candidate asks you questions");
    expect(prompts.interviewer_reply).not.toContain("probe the vaguest claim");
  });
});

describe("planning a round", () => {
  const plan = { role: "Backend Engineer", intro: "Hi, I'm the hiring manager.", questions: Array.from({ length: 6 }, (_, i) => ({ question: `Q${i + 1}?`, competency: "ownership" })) };

  it("asks for current, practical questions and today's date", async () => {
    const { llm, prompts } = scripted({ interview_plan: plan });
    const out = await planInterview(llm, { type: "technical" }, 3);

    expect(out.intro).toBe("Hi, I'm the hiring manager.");
    expect(out.questions).toHaveLength(3);
    expect(prompts.interview_plan).toContain(`Today's date is ${new Date().toISOString().slice(0, 10)}`);
    expect(prompts.interview_plan).toContain("Never use\nstock or dated questions");
    expect(prompts.interview_plan).toContain("AI coding tools");
    expect(prompts.interview_plan).toContain("Plan exactly 3 interview questions");
  });

  it("ends a full round with the candidate's questions", async () => {
    const { llm, prompts } = scripted({ interview_plan: plan });
    const out = await planInterview(llm, { type: "behavioral" }, 5, { closing: true });

    expect(prompts.interview_plan).toContain("Plan exactly 4 interview questions");
    expect(out.questions).toHaveLength(5);
    expect(out.questions[4]).toMatchObject({ kind: "candidate-questions", competency: "curiosity" });
    expect(COMPETENCIES.behavioral).toContain("curiosity");
  });

  it("gives every interview type a shape and modern competencies", () => {
    for (const shape of Object.values(ROUND_SHAPE)) expect(shape.topics >= 2 && shape.turns >= 3).toBe(true);
    expect(COMPETENCIES.behavioral).toContain("ai-collaboration");
    expect(COMPETENCIES.technical).toEqual(expect.arrayContaining(["code-review", "ai-assisted-development"]));
    expect(COMPETENCIES["system-design"]).toContain("ai-systems");
  });
});

describe("evaluating a conversation", () => {
  it("judges the whole exchange and credits clarifying questions", async () => {
    const { llm, prompts } = scripted({ answer_feedback: FEEDBACK });
    await evaluate(llm, { type: "system-design" }, exchanges, undefined, undefined, topic);
    expect(prompts.answer_feedback).toContain("across this whole conversation on one interview topic (ownership)");
    expect(prompts.answer_feedback).toContain("clarifying\nquestion counts in their favor");
  });

  it("scores the candidate's own questions in the closing part", async () => {
    const { llm, prompts } = scripted({ answer_feedback: FEEDBACK });
    await evaluate(llm, { type: "behavioral" }, exchanges, undefined, undefined, closingTopic());
    expect(prompts.answer_feedback).toContain("Evaluate the candidate's questions, not answers");
  });
});

describe("keeping requests small", () => {
  const posting = `${"We are a fast-growing company with a great culture. ".repeat(200)}`;

  it("cuts long pasted text at a sentence and says so", () => {
    const out = clip(posting, 500);
    expect(out.length).toBeLessThan(540);
    expect(out.endsWith("[...cut for length]")).toBe(true);
    expect(out).toMatch(/culture\.\n\[\.\.\.cut for length\]$/);
    expect(clip("short", 500)).toBe("short");
  });

  it("sends the interviewer only the gist of the posting mid-conversation", async () => {
    const plan = scripted({ interview_plan: { role: "r", intro: "", questions: [{ question: "Q?", competency: "ownership" }] } });
    await planInterview(plan.llm, { type: "behavioral", jobDescription: posting }, 1);
    const turn = scripted({ interviewer_reply: { reply: "And then?", move_on: false, candidate_asked_only: false } });
    await interviewerTurn(turn.llm, { type: "behavioral", jobDescription: posting }, topic, exchanges, 2);

    // Planning sees much more of the posting than each live reply does.
    expect(plan.prompts.interview_plan.length).toBeGreaterThan(6000);
    expect(turn.prompts.interviewer_reply.length).toBeLessThan(4500);
    expect(turn.prompts.interviewer_reply).toContain("[...cut for length]");
  });
});
