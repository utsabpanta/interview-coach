import type { LLM, ToolSpec } from "./llm.js";

export type InterviewType = "behavioral" | "technical" | "system-design";
export const INTERVIEW_TYPES: InterviewType[] = ["behavioral", "technical", "system-design"];

export interface Context {
  type: InterviewType;
  jobDescription?: string;
  resume?: string;
}

export interface PlannedQuestion {
  question: string;
  /** What the interviewer is probing for, e.g. "conflict resolution". */
  competency: string;
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
}

const INTERVIEWER = `You are an experienced hiring-panel interviewer at a strong technology company.
You are rigorous and fair. You ask one clear question at a time, the way a real interviewer would,
and you never invent facts about the candidate.`;

const COACH = `You are a direct, practical interview coach. You judge answers the way a hiring panel would.
Be specific: point at the exact part of the answer you mean. Do not flatter. Never invent facts,
metrics, or experiences the candidate did not state; where a detail is missing, say what to add
and mark the spot in a rewrite with a bracketed placeholder such as [metric].`;

function contextBlock(ctx: Context): string {
  const parts = [`Interview type: ${ctx.type}`];
  if (ctx.jobDescription) parts.push(`<job_description>\n${ctx.jobDescription}\n</job_description>`);
  if (ctx.resume) parts.push(`<resume>\n${ctx.resume}\n</resume>`);
  return parts.join("\n\n");
}

const TYPE_GUIDE: Record<InterviewType, string> = {
  behavioral:
    "Ask about past behavior (\"Tell me about a time...\"). Cover different competencies: ownership, conflict, failure, ambiguity, influence, delivery.",
  technical:
    "Ask conceptual and practical engineering questions suited to the role and the candidate's stack. No questions that require writing long code.",
  "system-design":
    "Ask open-ended design problems suited to the role's scale and domain. State the problem in two or three sentences and let the candidate drive.",
};

const PLAN_TOOL: ToolSpec = {
  name: "interview_plan",
  description: "Record the ordered list of interview questions.",
  schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            competency: { type: "string", description: "What this question probes, in a few words." },
          },
          required: ["question", "competency"],
        },
      },
    },
    required: ["questions"],
  },
};

export async function planQuestions(llm: LLM, ctx: Context, count: number): Promise<PlannedQuestion[]> {
  const user = `${contextBlock(ctx)}

Plan exactly ${count} interview questions. ${TYPE_GUIDE[ctx.type]}
Tailor them to the job description and resume when provided, and order them from warm-up to hardest.`;
  const out = await llm.structured<{ questions: PlannedQuestion[] }>(INTERVIEWER, user, PLAN_TOOL);
  return (out.questions ?? []).slice(0, count);
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
    },
    required: ["scores", "strengths", "improvements", "rewrite"],
  },
};

export async function evaluate(llm: LLM, ctx: Context, exchanges: Exchange[]): Promise<Feedback> {
  const transcript = exchanges
    .map((e, i) => `${i === 0 ? "Question" : "Follow-up"}: ${e.question}\nAnswer: ${e.answer}`)
    .join("\n\n");
  const user = `${contextBlock(ctx)}

Evaluate the candidate's answer to the main question, taking the follow-up into account.

<transcript>
${transcript}
</transcript>`;
  return llm.structured<Feedback>(COACH, user, FEEDBACK_TOOL, 2500);
}

export async function buildStories(llm: LLM, resume: string, jobDescription?: string): Promise<string> {
  const user = `<resume>
${resume}
</resume>
${jobDescription ? `\n<job_description>\n${jobDescription}\n</job_description>\n` : ""}
Build a story bank of 6 to 8 interview stories from this resume, in Markdown.

For each story give:
- a short title and the resume item it comes from
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
