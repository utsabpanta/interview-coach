import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { averageScore, type Exchange, type Feedback, type InterviewType } from "./coach.js";
import type { DeliveryMetrics } from "./metrics.js";
import type { Pacing } from "./voice.js";

export interface Round {
  competency: string;
  /** Story-bank story this round rehearsed, if any. */
  story?: string;
  exchanges: Exchange[];
  feedback: Feedback;
  metrics: DeliveryMetrics;
  /** Present for spoken answers. */
  pacing?: Pacing;
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

export function renderFeedback(feedback: Feedback, metrics: DeliveryMetrics, pacing?: Pacing): string {
  const s = feedback.scores;
  // With a real recording, measured timing replaces the word-count estimate.
  const delivery = pacing
    ? `Delivery: ${metrics.words} words in ${pacing.durationSeconds}s (${pacing.wordsPerMinute} wpm), ${metrics.fillerCount} filler words`
    : `Delivery: ${metrics.words} words, about ${metrics.estimatedMinutes} min spoken, ${metrics.fillerCount} filler words`;
  const notes = pacing
    ? [...pacing.notes, ...metrics.notes.filter((n) => !/^(Short|Long):/.test(n))]
    : metrics.notes;
  const lines = [
    `Score: ${averageScore(feedback)}/5  (structure ${s.structure}, specificity ${s.specificity}, relevance ${s.relevance}, concision ${s.concision})`,
    delivery,
    ...notes.map((n) => `  - ${n}`),
    ...(feedback.fix ? ["", `Fix first: ${feedback.fix.headline}`, `  ${feedback.fix.detail}`] : []),
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
    if (round.story) out.push(`Target story: ${round.story}`, "");
    round.exchanges.forEach((e, j) => {
      out.push(`**${j === 0 ? "Interviewer" : "Follow-up"}:** ${e.question}`, "", `**You:** ${e.answer}`, "");
    });
    out.push("### Feedback", "", "```", renderFeedback(round.feedback, round.metrics, round.pacing), "```", "");
  });
  return out.join("\n");
}

/** Saves a readable Markdown transcript and a JSON record used by `coach progress`. */
export async function saveSession(session: Session, dir = "sessions"): Promise<string> {
  await mkdir(dir, { recursive: true });
  const stamp = session.startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = path.join(dir, `${stamp}-${session.type}`);
  await writeFile(`${base}.md`, renderSession(session), "utf8");
  await writeFile(`${base}.json`, JSON.stringify({ version: 1, ...session }, null, 2), "utf8");
  return `${base}.md`;
}

/** Loads saved sessions, oldest first. Unreadable or malformed files are skipped. */
export async function loadSessions(dir = "sessions"): Promise<Session[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const sessions: Session[] = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    try {
      const raw = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      const startedAt = new Date(raw.startedAt);
      if (!Array.isArray(raw.rounds) || Number.isNaN(startedAt.getTime())) continue;
      const rounds = (raw.rounds as Round[]).filter((r) => r?.feedback?.scores && r?.metrics);
      sessions.push({ type: raw.type, startedAt, rounds });
    } catch {
      // Not a session file.
    }
  }
  return sessions.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}
