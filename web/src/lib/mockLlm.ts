import { COMPETENCIES, type Feedback, type InterviewPlan } from "../../../src/coach.js";
import type { LLM, ToolSpec } from "../../../src/types.js";

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
        questions: Array.from({ length: count }, (_, i) => ({
          question: `Mock question ${i + 1}: tell me about a project you owned that went off the rails.`,
          competency: drill ?? COMPETENCIES.behavioral[i % COMPETENCIES.behavioral.length],
        })),
      };
      return plan as T;
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
      changes: retry ? ['You named your decision: "I called a pause".', "Still missing: the result."] : undefined,
    };
    return feedback as T;
  }
}
