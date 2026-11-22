import type { LLM, ToolSpec } from "./types.js";

export type InterviewType = "behavioral" | "technical" | "system-design";
export const INTERVIEW_TYPES: InterviewType[] = ["behavioral", "technical", "system-design"];

/** Fixed labels, so progress can be tracked by competency across sessions. */
export const COMPETENCIES: Record<InterviewType, string[]> = {
  behavioral: ["ownership", "conflict", "failure", "ambiguity", "influence", "delivery", "leadership", "growth"],
  technical: ["fundamentals", "debugging", "architecture", "testing", "performance", "tooling"],
  "system-design": ["requirements", "data-modeling", "api-design", "scalability", "reliability", "trade-offs"],
};

export interface Context {
  type: InterviewType;
  jobDescription?: string;
  resume?: string;
  /** A story bank (from `coach stories`) to rehearse against. */
  stories?: string;
  /** Restrict rehearsal to stories matching this text. */
  storyFocus?: string;
  /** Drill mode: every question probes this one competency. */
  focusCompetency?: string;
}

export interface PlannedQuestion {
  question: string;
  /** What the interviewer is probing for; one of COMPETENCIES for the type. */
  competency: string;
  /** Title of the story-bank story this question targets, in rehearsal mode. */
  story?: string;
}

export interface Exchange {
  question: string;
  answer: string;
}

export interface Feedback {
  scores: {
    structure: number;
    specificity: number;
    relevance: number;
    concision: number;
  };
  strengths: string[];
  improvements: string[];
  /** A tighter version of the answer using only facts the candidate gave. */
  rewrite: string;
  /** The single most important change, with the phrase from the answer that shows it. */
  fix?: { headline: string; detail: string; quote?: string };
  /** On a retry: what changed against the previous attempt. */
  changes?: string[];
}

export interface InterviewPlan {
  /** Short job title taken from the job description, or a generic one. */
  role: string;
  questions: PlannedQuestion[];
}

export const DIMENSIONS = ["structure", "specificity", "relevance", "concision"] as const;

const INTERVIEWER = `You are an experienced hiring-panel interviewer at a strong technology company.
You are rigorous and fair. You ask one clear question at a time, the way a real interviewer would,
and you never invent facts about the candidate.`;

export const COACH = `You are a direct, practical interview coach. You judge answers the way a hiring panel would.
Be specific: point at the exact part of the answer you mean. Do not flatter. Never invent facts,
metrics, or experiences the candidate did not state; where a detail is missing, say what to add
and mark the spot in a rewrite with a bracketed placeholder such as [metric].`;

function contextBlock(ctx: Context): string {
  const parts = [`Interview type: ${ctx.type}`];
  if (ctx.jobDescription) parts.push(`<job_description>\n${ctx.jobDescription}\n</job_description>`);
  if (ctx.resume) parts.push(`<resume>\n${ctx.resume}\n</resume>`);
  if (ctx.stories) parts.push(`<story_bank>\n${ctx.stories}\n</story_bank>`);
  return parts.join("\n\n");
}

const TYPE_GUIDE: Record<InterviewType, string> = {
  behavioral:
    "Ask about past behavior (\"Tell me about a time...\"). Cover different competencies.",
  technical:
    "Ask conceptual and practical engineering questions suited to the role and the candidate's stack. No questions that require writing long code.",
  "system-design":
    "Ask open-ended design problems suited to the role's scale and domain. State the problem in two or three sentences and let the candidate drive.",
};

function planTool(ctx: Context): ToolSpec {
  const item: Record<string, unknown> = {
    question: { type: "string" },
    competency: { type: "string", enum: COMPETENCIES[ctx.type], description: "The main thing this question probes." },
  };
  const required = ["question", "competency"];
  if (ctx.stories) {
    item.story = { type: "string", description: "Exact title of the story-bank story this question targets." };
    required.push("story");
  }
  return {
    name: "interview_plan",
    description: "Record the ordered list of interview questions.",
    schema: {
      type: "object",
      properties: {
        role: { type: "string", description: "The job title from the job description in a few words, or \"General practice\" if there is none." },
        questions: { type: "array", items: { type: "object", properties: item, required } },
      },
      required: ["role", "questions"],
    },
  };
}

export async function planQuestions(llm: LLM, ctx: Context, count: number): Promise<PlannedQuestion[]> {
  return (await planInterview(llm, ctx, count)).questions;
}

export async function planInterview(llm: LLM, ctx: Context, count: number): Promise<InterviewPlan> {
  let user = `${contextBlock(ctx)}

Plan exactly ${count} interview questions. ${TYPE_GUIDE[ctx.type]}
Tailor them to the job description and resume when provided, and order them from warm-up to hardest.`;
  if (ctx.stories) {
    user += `

This is a rehearsal of the candidate's story bank. Each question must be one that a specific story
in the bank answers well; set "story" to that story's exact title and use a different story for each
question where possible.${ctx.storyFocus ? ` Only target stories matching "${ctx.storyFocus}".` : ""}
Phrase each question as a real interviewer would, without naming or hinting at the story.`;
  }
  if (ctx.focusCompetency) {
    user += `

This is a focused drill: every question must probe "${ctx.focusCompetency}" from a different angle,
and each question's competency must be "${ctx.focusCompetency}".`;
  }
  const out = await llm.structured<InterviewPlan>(INTERVIEWER, user, planTool(ctx));
  return { role: (out.role ?? "").trim() || "General practice", questions: (out.questions ?? []).slice(0, count) };
}

export async function followUp(llm: LLM, ctx: Context, exchange: Exchange): Promise<string> {
  const user = `${contextBlock(ctx)}

You asked: ${exchange.question}

The candidate answered:
<answer>
${exchange.answer}
</answer>

Ask the single most useful follow-up question: probe the vaguest claim, the missing result, or the
candidate's own role. Reply with the question only.`;
  return llm.text(INTERVIEWER, user, 300);
}

const score = { type: "integer", minimum: 1, maximum: 5 };

const FEEDBACK_TOOL: ToolSpec = {
  name: "answer_feedback",
  description: "Record scored feedback on an interview answer.",
  schema: {
    type: "object",
    properties: {
      scores: {
        type: "object",
        description: "1 = poor, 3 = acceptable, 5 = excellent.",
        properties: {
          structure: { ...score, description: "Clear arc: situation, action, result (or problem, approach, trade-offs)." },
          specificity: { ...score, description: "Concrete details, numbers, and the candidate's own actions." },
          relevance: { ...score, description: "Answers the question asked and fits the role." },
          concision: { ...score, description: "No rambling, repetition, or preamble." },
        },
        required: ["structure", "specificity", "relevance", "concision"],
      },
      strengths: { type: "array", items: { type: "string" }, description: "Up to 3, each one sentence." },
      improvements: { type: "array", items: { type: "string" }, description: "Up to 3 concrete changes, most important first." },
      rewrite: { type: "string", description: "A stronger version of the answer using only stated facts, with [placeholders] for missing details." },
      fix: {
        type: "object",
        description: "The single most important change for the candidate's next attempt.",
        properties: {
          headline: { type: "string", description: "The fix as one short imperative sentence, under 12 words." },
          detail: { type: "string", description: "Why it matters and how to do it, in one or two sentences." },
          quote: { type: "string", description: "A short phrase copied exactly from the answer that shows the problem. Omit if none fits." },
        },
        required: ["headline", "detail"],
      },
      changes: { type: "array", items: { type: "string" }, description: "Only when a previous attempt is given: up to 3 short sentences on what improved, got worse, or is still missing." },
    },
    required: ["scores", "strengths", "improvements", "rewrite", "fix"],
  },
};

export interface PreviousAttempt {
  answer: string;
  feedback: Feedback;
}

export async function evaluate(
  llm: LLM,
  ctx: Context,
  exchanges: Exchange[],
  story?: string,
  previous?: PreviousAttempt,
): Promise<Feedback> {
  const transcript = exchanges
    .map((e, i) => `${i === 0 ? "Question" : "Follow-up"}: ${e.question}\nAnswer: ${e.answer}`)
    .join("\n\n");
  let user = `${contextBlock(ctx)}

Evaluate the candidate's answer to the main question, taking the follow-up into account.

<transcript>
${transcript}
</transcript>`;
  if (ctx.stories && story) {
    user += `

The candidate prepared the story titled "${story}" in the story bank for this kind of question.
If they told a different story, say so. In the improvements, name any important prepared detail
they left out. The rewrite may use facts from that story as well as from the answer.`;
  }
  if (previous) {
    user += `

This is a retry. The candidate's previous attempt at the same question was:
<previous_answer>
${previous.answer}
</previous_answer>
It was told to fix: ${previous.feedback.fix?.headline ?? previous.feedback.improvements[0] ?? "nothing specific"}
Score the new answer on its own merits with the same standard, and fill in "changes" by comparing
the two attempts. Choose a different "fix" if the earlier one has been addressed.`;
  }
  return llm.structured<Feedback>(COACH, user, FEEDBACK_TOOL, 2500);
}

export async function buildStories(llm: LLM, resume: string, jobDescription?: string): Promise<string> {
  const user = `<resume>
${resume}
</resume>
${jobDescription ? `\n<job_description>\n${jobDescription}\n</job_description>\n` : ""}
Build a story bank of 6 to 8 interview stories from this resume, in Markdown.

For each story give:
- a level-2 heading with a short title, then the resume item it comes from
- Situation, Task, Action, Result as four short bullets, using only facts in the resume
- "Fill in:" a list of the specific details the candidate must add from memory (numbers, the
  hardest decision, what went wrong), since the resume will not contain them
- "Use for:" the common interview questions this story answers

Choose stories that together cover ownership, conflict, failure, ambiguity, influence, and
technical depth${jobDescription ? ", weighted toward what the job description asks for" : ""}.
End with a table mapping common questions to the best story for each. Do not invent facts.`;
  return llm.text(COACH, user, 4000);
}

export function averageScore(f: Feedback): number {
  const s = f.scores;
  return Math.round(((s.structure + s.specificity + s.relevance + s.concision) / 4) * 10) / 10;
}
