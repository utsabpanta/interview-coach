import type { LLM, ToolSpec } from "./types.js";

export type InterviewType = "behavioral" | "technical" | "system-design";
export const INTERVIEW_TYPES: InterviewType[] = ["behavioral", "technical", "system-design"];

/** Fixed labels, so progress can be tracked by competency across sessions. */
export const COMPETENCIES: Record<InterviewType, string[]> = {
  behavioral: ["ownership", "conflict", "failure", "ambiguity", "influence", "prioritization", "delivery", "leadership", "growth", "ai-collaboration", "curiosity"],
  technical: ["debugging", "code-review", "system-understanding", "ai-assisted-development", "testing", "performance", "security", "fundamentals"],
  "system-design": ["requirements", "data-modeling", "api-design", "scalability", "reliability", "trade-offs", "ai-systems", "cost"],
};

/**
 * How long a round runs: topics planned by the model, and how many times the
 * candidate may speak on each before the interviewer moves on. Design rounds
 * go deep on few problems; behavioral rounds cover more ground.
 */
export const ROUND_SHAPE: Record<InterviewType, { topics: number; turns: number }> = {
  behavioral: { topics: 4, turns: 3 },
  technical: { topics: 3, turns: 4 },
  "system-design": { topics: 2, turns: 6 },
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
  /** "candidate-questions" is the closing part, where the candidate interviews the interviewer. */
  kind?: "candidate-questions";
}

export interface Exchange {
  question: string;
  answer: string;
  /** The candidate only asked the interviewer something (repeat, rephrase, clarify); not an answer. */
  aside?: boolean;
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
  /** The interviewer's spoken opening: who they are and how the round will run. */
  intro: string;
  questions: PlannedQuestion[];
}

export const DIMENSIONS = ["structure", "specificity", "relevance", "concision"] as const;

const INTERVIEWER = `You are an experienced hiring manager running a live, spoken interview.
You are rigorous, fair, and human: you listen, react to what was actually said, answer the
candidate's questions, and push on anything vague. You ask one clear question at a time and you
never invent facts about the candidate.`;

/** Keeps the model anchored to current practice instead of the stock questions it has seen most. */
function practiceNote(): string {
  return `Today's date is ${new Date().toISOString().slice(0, 10)}. Interview the way strong teams do now:
practical, conversational, and close to the real work of this role. AI tools are part of everyday
work, so judge how candidates direct them, check their output, and know their limits. Never use
stock or dated questions: no "greatest weakness", "where do you see yourself in five years",
"why should we hire you", brainteasers, trivia, or memorized algorithm puzzles. If the role is not
a software role, apply the same principles to that field's real work.`;
}

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
  behavioral: `Ask about real past work, never hypotheticals. Start with a deep dive into one recent
project (from the resume when there is one): what they built, the decisions that were theirs, and
what they would change. Include one question about how they actually work with AI tools, asked
through their workflow and judgment ("walk me through a recent piece of work where AI did part of
it; what did you check, and what did you not trust it with?") rather than "which tools do you use".
Each question covers a different competency.`,
  technical: `Ask practical, scenario-based questions that simulate the job and can be worked through
aloud. Draw from: debugging a production incident step by step; reviewing a described change or a
piece of AI-generated code for what is wrong or risky; getting up to speed on an unfamiliar codebase
or system; designing a small real component such as a rate limiter, a retry policy, or a cache; and
deciding how to test and ship a risky change. Include one about working with AI coding tools:
directing them, verifying what they produce, and knowing when not to rely on them. State each
scenario concretely, with enough detail to reason about. Nothing that needs code written out.`,
  "system-design": `Pose open-ended design problems that fit the role's domain and scale. State each
in two or three sentences and leave the requirements deliberately open, so the candidate has to ask
clarifying questions before designing. Unless the role clearly has nothing to do with it, make one
problem an AI- or LLM-powered feature in production, where evaluation, latency, cost, and failure
handling matter. Expect trade-offs, cost, and operations to be discussed, not just components.`,
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
        intro: {
          type: "string",
          description:
            "Your spoken opening, two sentences: greet the candidate, say you are the hiring manager for the role, and say how this round will run. Do not invent a name for yourself or facts about the company.",
        },
        questions: { type: "array", items: { type: "object", properties: item, required } },
      },
      required: ["role", "intro", "questions"],
    },
  };
}

export async function planQuestions(llm: LLM, ctx: Context, count: number): Promise<PlannedQuestion[]> {
  return (await planInterview(llm, ctx, count)).questions;
}

/** The closing part of a real interview: the candidate asks, the interviewer answers. */
export function closingTopic(): PlannedQuestion {
  return {
    question: "We have a few minutes left, and I want to leave them for you. What would you like to ask me about the role or the team?",
    competency: "curiosity",
    kind: "candidate-questions",
  };
}

/**
 * Plans a round. With `closing`, the last of the `count` topics is the
 * candidate's own questions for the interviewer.
 */
export async function planInterview(llm: LLM, ctx: Context, count: number, opts: { closing?: boolean } = {}): Promise<InterviewPlan> {
  const planned = opts.closing ? Math.max(1, count - 1) : count;
  const plan = await planTopics(llm, ctx, planned);
  return opts.closing ? { ...plan, questions: [...plan.questions, closingTopic()] } : plan;
}

async function planTopics(llm: LLM, ctx: Context, count: number): Promise<InterviewPlan> {
  let user = `${contextBlock(ctx)}

${practiceNote()}

Plan exactly ${count} interview questions. Each one opens a short conversation: you will follow up
live, so ask the opening question only, without sub-questions.

${TYPE_GUIDE[ctx.type]}

Tailor everything to the job description and resume when provided, and order the questions from
warm-up to hardest.`;
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
  return normalizePlan(out, ctx, count);
}

export interface InterviewerReply {
  /** What the interviewer says next. */
  reply: string;
  /** True when the interviewer is finished with this topic. */
  done: boolean;
  /** True when the candidate's last message was only a request, so it should not use up a turn. */
  aside: boolean;
}

const TURN_TOOL: ToolSpec = {
  name: "interviewer_reply",
  description: "The interviewer's next spoken turn in the conversation.",
  schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "What you say next, as spoken words: one to three sentences." },
      move_on: {
        type: "boolean",
        description: "True when this topic is covered well enough, or the candidate is stuck or finished, and the interview should move to the next topic.",
      },
      candidate_asked_only: {
        type: "boolean",
        description:
          "True when the candidate's last message was only a request to you, with no answer in it: asking you to repeat or rephrase, to clarify what you mean, or for a moment to think.",
      },
    },
    required: ["reply", "move_on", "candidate_asked_only"],
  },
};

function renderConversation(exchanges: Exchange[]): string {
  return exchanges.map((e) => `Interviewer: ${e.question}\nCandidate: ${e.answer}`).join("\n\n");
}

/**
 * The interviewer's side of a live, two-way conversation on one topic: it
 * reacts, answers the candidate's questions, probes, and decides when to move on.
 * `turnsLeft` is how many more times the candidate may speak on this topic.
 */
export async function interviewerTurn(
  llm: LLM,
  ctx: Context,
  topic: PlannedQuestion,
  exchanges: Exchange[],
  turnsLeft: number,
): Promise<InterviewerReply> {
  const closing = topic.kind === "candidate-questions";
  const rules = closing
    ? `This is the part of the interview where the candidate asks you questions. Answer what they just
asked, briefly and candidly, as the hiring manager for this role. Use the job description; where it
does not say, describe what is typical for such a team and say you would confirm the specifics.
Then invite the next question. If the candidate has nothing more to ask, set move_on to true and
close the interview warmly in one sentence.`
    : `Give your next turn. Rules:
- Listen first. If the candidate asked you to repeat the question, say it again. If they asked you
  to rephrase or did not understand, put it in simpler, different words. If they asked for a moment
  to think, tell them to take their time. Do none of the things below in that case, and set
  candidate_asked_only to true.
- React to what the candidate just said, briefly and specifically, the way a person would. Do not
  praise, grade, or summarize their answer back to them.
- If the candidate asked you something (a clarification, a requirement, a number, what you meant),
  answer it directly first. For details you were not given, state a reasonable assumption for this
  exercise ("Let's say...").
- Then ask one thing: probe the vaguest claim, the missing result, their own part in it, or a
  trade-off; push back if something does not add up; in a technical or design discussion, add a
  constraint or change a requirement, or give a small hint if they are stuck.
- One question at a time and no lists. Do not ask something they have already answered, and do not
  answer your own question or solve the problem for them.
- When the topic is covered, or no turns remain, set move_on to true and reply with a short closing
  remark only, with no question in it.`;

  const user = `${contextBlock(ctx)}

You are assessing: ${topic.competency}

<conversation>
${renderConversation(exchanges)}
</conversation>

The first thing you asked on this topic was: ${exchanges[0]?.question ?? topic.question}

Turns the candidate has left on this topic after your reply: ${Math.max(0, turnsLeft)}.

${rules}`;

  const raw = await llm.structured<{ reply?: unknown; move_on?: unknown; candidate_asked_only?: unknown }>(INTERVIEWER, user, TURN_TOOL, 600);
  const reply = typeof raw?.reply === "string" ? raw.reply.trim() : "";
  const yes = (x: unknown) => x === true || x === "true";
  // A request to repeat or clarify is answered and the conversation carries on, even on the last turn.
  const aside = Boolean(reply) && !closing && yes(raw?.candidate_asked_only);
  const done = !aside && (turnsLeft <= 0 || yes(raw?.move_on) || !reply);
  return { reply, done, aside };
}

const scoreSchema = { type: "integer", minimum: 1, maximum: 5 };

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
          structure: { ...scoreSchema, description: "Clear arc: situation, action, result (or problem, approach, trade-offs)." },
          specificity: { ...scoreSchema, description: "Concrete details, numbers, and the candidate's own actions." },
          relevance: { ...scoreSchema, description: "Answers the question asked and fits the role." },
          concision: { ...scoreSchema, description: "No rambling, repetition, or preamble." },
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
  topic?: Pick<PlannedQuestion, "kind" | "competency">,
): Promise<Feedback> {
  const closing = topic?.kind === "candidate-questions";
  let user = `${contextBlock(ctx)}

${
  closing
    ? `This was the closing part of the interview, where the candidate asks the interviewer questions.
Evaluate the candidate's questions, not answers: structure means they led with what matters most
and followed up on what they heard; specificity means the questions were about this role and team
and not ones that fit any company; relevance means they help decide whether to take the job and
show real interest; concision means they were asked plainly. The "rewrite" is two or three sharper
questions they could have asked.`
    : `Evaluate how the candidate did across this whole conversation on one interview topic${topic ? ` (${topic.competency})` : ""}.
Judge the substance of what they said, how they handled the interviewer's probing, and whether
they got more specific under pressure or stayed vague. Asking the interviewer a good clarifying
question counts in their favor, especially on a design or technical problem. Asking the
interviewer to repeat or rephrase something is normal and must not lower any score. The "rewrite"
is a stronger version of their main answer.`
}

<transcript>
${renderConversation(exchanges)}
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
  return normalizeFeedback(await llm.structured<unknown>(COACH, user, FEEDBACK_TOOL, 2500));
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

// Smaller models do not always follow a schema exactly, so model output is
// coerced into shape here instead of being trusted.

const text = (x: unknown): string => (typeof x === "string" ? x.trim() : "");

function list(x: unknown, max: number): string[] {
  const items = Array.isArray(x) ? x : typeof x === "string" && x.trim() ? [x] : [];
  return items.map(text).filter(Boolean).slice(0, max);
}

/** Thrown when the model's evaluation cannot be trusted, so no score is shown. */
export class EvaluationError extends Error {
  constructor() {
    super("The model did not return usable scores for this answer. Try scoring again, or pick a larger model in Settings.");
    this.name = "EvaluationError";
  }
}

/** A score is only accepted if the model actually gave a number from 1 to 5. */
function score(x: unknown): number {
  const n = typeof x === "number" ? x : typeof x === "string" && /^\s*\d+(\.\d+)?\s*$/.test(x) ? Number(x) : NaN;
  if (!Number.isFinite(n) || n < 1 || n > 5) throw new EvaluationError();
  return Math.round(n);
}

const asObject = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/** Some models wrap the result in the tool-call envelope; look one level in. */
function unwrap(raw: unknown): Record<string, unknown> {
  const r = asObject(raw) ?? {};
  if (asObject(r.scores)) return r;
  for (const key of ["arguments", "input", "parameters", "answer_feedback", "feedback"]) {
    const inner = asObject(r[key]);
    if (inner && asObject(inner.scores)) return inner;
  }
  return r;
}

/**
 * Coerces the model's evaluation into shape. Wording is tidied up freely, but
 * scores are never invented: if any is missing or out of range this throws,
 * and the caller offers to score again.
 */
export function normalizeFeedback(raw: unknown): Feedback {
  const r = unwrap(raw);
  const s = asObject(r.scores);
  if (!s) throw new EvaluationError();
  const f = (r.fix && typeof r.fix === "object" ? r.fix : {}) as Record<string, unknown>;
  const improvements = list(r.improvements, 3);
  const headline = text(f.headline) || improvements[0] || "";
  const changes = list(r.changes, 3);
  return {
    scores: {
      structure: score(s.structure),
      specificity: score(s.specificity),
      relevance: score(s.relevance),
      concision: score(s.concision),
    },
    strengths: list(r.strengths, 3),
    improvements,
    rewrite: text(r.rewrite),
    ...(headline ? { fix: { headline, detail: text(f.detail), ...(text(f.quote) ? { quote: text(f.quote) } : {}) } } : {}),
    ...(changes.length ? { changes } : {}),
  };
}

export function normalizePlan(raw: unknown, ctx: Context, count: number): InterviewPlan {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed = COMPETENCIES[ctx.type];
  const intro = text(r.intro);
  const questions = (Array.isArray(r.questions) ? r.questions : [])
    .map((q): PlannedQuestion | null => {
      const item = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
      const question = text(item.question);
      if (!question) return null;
      const named = text(item.competency).toLowerCase();
      const competency = ctx.focusCompetency ?? (allowed.includes(named) ? named : named || "general");
      return { question, competency, ...(text(item.story) ? { story: text(item.story) } : {}) };
    })
    .filter((q): q is PlannedQuestion => q !== null)
    .slice(0, count);
  return { role: text(r.role) || "General practice", intro, questions };
}

export function averageScore(f: Feedback): number {
  const s = f.scores;
  return Math.round(((s.structure + s.specificity + s.relevance + s.concision) / 4) * 10) / 10;
}
