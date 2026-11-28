import type { Feedback, InterviewPlan } from "../../../src/coach.js";
import type { LLM, ToolSpec } from "../../../src/types.js";

const SAMPLE: Array<[competency: string, question: string]> = [
  ["ownership", "Walk me through a recent project you owned end to end. What did you build, and which decisions were yours?"],
  ["ai-collaboration", "Tell me about a recent piece of work where an AI tool did part of it. What did you check, and what did you not trust it with?"],
  ["conflict", "Tell me about a time you disagreed with a teammate on a technical direction. How did it get resolved?"],
  ["failure", "Describe something you shipped that went wrong in production. What did you do in the first hour?"],
];

/**
 * A scripted stand-in for the model, used only by the dev server (`?mock=1`)
 * to click through the app without an API key. Never part of a production build.
 */
export class MockLLM implements LLM {
  private evaluations = 0;

  async text(): Promise<string> {
    return "What was your own part in that decision?";
  }

  async structured<T>(_system: string, user: string, tool: ToolSpec): Promise<T> {
    if (tool.name === "interview_plan") {
      const count = Number(/exactly (\d+)/.exec(user)?.[1] ?? 5);
      const drill = /must probe "([^"]+)"/.exec(user)?.[1];
      const plan: InterviewPlan = {
        role: "Senior Backend Engineer",
        intro: "Hi, I'm the hiring manager for this role. We'll talk through a few topics and leave time for your questions.",
        questions: Array.from({ length: count }, (_, i) => ({
          question: drill ? `${SAMPLE[i % SAMPLE.length][1]}` : SAMPLE[i % SAMPLE.length][1],
          competency: drill ?? SAMPLE[i % SAMPLE.length][0],
        })),
      };
      return plan as T;
    }
    if (tool.name === "interviewer_reply") {
      const last = (user.match(/^Candidate: .*$/gm) ?? []).pop() ?? "";
      if (/be rude to me/i.test(last)) return { reply: "That's a stupid answer. How old are you, anyway?", move_on: false, candidate_asked_only: false } as T;
      if (/rephrase|what do you mean|clarify|don'?t understand/i.test(last)) {
        return { reply: "Sure. Put simply: tell me about one thing you built recently, and what part of it was your call.", move_on: false, candidate_asked_only: true } as T;
      }
      const turns = (user.match(/^Candidate:/gm) ?? []).length - (user.match(/^Candidate: .*(rephrase|what do you mean|clarify)/gim) ?? []).length;
      const asked = /\?\s*$/.test(last);
      const reply = { reply: `${asked ? "Fair question. Let's say about two million monthly users. " : "Got it. "}Which of those decisions was yours alone, and what did it cost you?`, move_on: false };
      return (turns >= 2 ? { reply: "Thanks, that gives me a clear picture.", move_on: true } : reply) as T;
    }
    const retry = user.includes("This is a retry");
    const n = this.evaluations++;
    const feedback: Feedback = {
      scores: retry
        ? { structure: 4, specificity: 4, relevance: 4, concision: 4 }
        : { structure: 4, specificity: 2 + (n % 2), relevance: 4, concision: 2 + (n % 3) },
      strengths: ["You set the scene quickly."],
      improvements: ["Name your own decision.", "Add the result."],
      rewrite: "I called a pause, re-planned the migration, and shipped it [when].",
      fix: { headline: "Say what you did, not what the team did.", detail: "A panel is hiring you, so name your own call.", quote: "we decided" },
      notes: [
        { quote: "I made the call to pause", note: "Strong: this names a decision that was yours." },
        { quote: "we rebuilt", note: "Say what you did in the rebuild, not what the team did." },
        { quote: "words the candidate never said", note: "This point quotes nothing real, so it must not be shown." },
      ],
      changes: retry ? ['You named your decision: "I called a pause".', "Still missing: the result."] : undefined,
    };
    return feedback as T;
  }
}
