import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { averageScore, type Exchange, type Feedback, type InterviewType } from "./coach.js";
import type { DeliveryMetrics } from "./metrics.js";

export interface Round {
  competency: string;
  exchanges: Exchange[];
  feedback: Feedback;
  metrics: DeliveryMetrics;
}

export interface Session {
  type: InterviewType;
  startedAt: Date;
  rounds: Round[];
}

export function overallScore(session: Session): number | null {
  if (session.rounds.length === 0) return null;
  const total = session.rounds.reduce((sum, r) => sum + averageScore(r.feedback), 0);
  return Math.round((total / session.rounds.length) * 10) / 10;
}

export function renderFeedback(feedback: Feedback, metrics: DeliveryMetrics): string {
  const s = feedback.scores;
  const lines = [
    `Score: ${averageScore(feedback)}/5  (structure ${s.structure}, specificity ${s.specificity}, relevance ${s.relevance}, concision ${s.concision})`,
    `Delivery: ${metrics.words} words, about ${metrics.estimatedMinutes} min spoken, ${metrics.fillerCount} filler words`,
    ...metrics.notes.map((n) => `  - ${n}`),
    "",
    "Strengths:",
    ...feedback.strengths.map((x) => `  - ${x}`),
    "",
    "Improve:",
    ...feedback.improvements.map((x) => `  - ${x}`),
    "",
    "Stronger version:",
    feedback.rewrite,
  ];
  return lines.join("\n");
}

export function renderSession(session: Session): string {
  const overall = overallScore(session);
  const out: string[] = [
    `# Mock interview: ${session.type}`,
    "",
    `Date: ${session.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    `Questions answered: ${session.rounds.length}`,
    `Overall score: ${overall === null ? "n/a" : `${overall}/5`}`,
    "",
  ];
  session.rounds.forEach((round, i) => {
    out.push(`## Question ${i + 1}: ${round.competency}`, "");
    round.exchanges.forEach((e, j) => {
      out.push(`**${j === 0 ? "Interviewer" : "Follow-up"}:** ${e.question}`, "", `**You:** ${e.answer}`, "");
    });
    out.push("### Feedback", "", "```", renderFeedback(round.feedback, round.metrics), "```", "");
  });
  return out.join("\n");
}

export async function saveSession(session: Session, dir = "sessions"): Promise<string> {
  await mkdir(dir, { recursive: true });
  const stamp = session.startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `${stamp}-${session.type}.md`);
  await writeFile(file, renderSession(session), "utf8");
  return file;
}
