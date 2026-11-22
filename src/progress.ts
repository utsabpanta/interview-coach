import { averageScore, DIMENSIONS } from "./coach.js";
import { overallScore, type Session } from "./session.js";

export interface CompetencyStat {
  competency: string;
  answers: number;
  average: number;
  /** Score of the earliest and the most recent answer. */
  first: number;
  latest: number;
}

export interface Progress {
  sessions: Array<{ date: string; type: string; answers: number; score: number }>;
  totalAnswers: number;
  competencies: CompetencyStat[];
  dimensions: Record<(typeof DIMENSIONS)[number], number>;
  weakestDimension: (typeof DIMENSIONS)[number] | null;
  /** Average filler words per 100 words. */
  fillerRate: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Aggregates saved sessions (oldest first). Pure: no I/O. */
export function summarize(sessions: Session[]): Progress {
  const answered = sessions.filter((s) => s.rounds.length > 0);
  const rounds = answered.flatMap((s) => s.rounds);

  const byCompetency = new Map<string, number[]>();
  for (const r of rounds) {
    const key = r.competency.trim().toLowerCase() || "general";
    byCompetency.set(key, [...(byCompetency.get(key) ?? []), averageScore(r.feedback)]);
  }
  const competencies = [...byCompetency.entries()]
    .map(([competency, scores]) => ({
      competency,
      answers: scores.length,
      average: round1(mean(scores)),
      first: scores[0],
      latest: scores[scores.length - 1],
    }))
    .sort((a, b) => a.average - b.average || a.competency.localeCompare(b.competency));

  const dimensions = Object.fromEntries(
    DIMENSIONS.map((d) => [d, round1(mean(rounds.map((r) => r.feedback.scores[d])))]),
  ) as Progress["dimensions"];
  const weakestDimension = rounds.length
    ? DIMENSIONS.reduce((worst, d) => (dimensions[d] < dimensions[worst] ? d : worst))
    : null;

  return {
    sessions: answered.map((s) => ({
      date: s.startedAt.toISOString().slice(0, 10),
      type: s.type,
      answers: s.rounds.length,
      score: overallScore(s) ?? 0,
    })),
    totalAnswers: rounds.length,
    competencies,
    dimensions,
    weakestDimension,
    fillerRate: round1(mean(rounds.map((r) => r.metrics.fillerRate))),
  };
}

function trend(first: number, latest: number, answers: number): string {
  if (answers < 2) return "";
  const delta = round1(latest - first);
  if (delta === 0) return "flat";
  return delta > 0 ? `up ${delta}` : `down ${Math.abs(delta)}`;
}

export function renderProgress(p: Progress): string {
  if (p.totalAnswers === 0) {
    return "No saved sessions yet. Run `coach mock` or `coach voice` first.";
  }
  const out: string[] = [`${p.totalAnswers} answers across ${p.sessions.length} sessions`, "", "Sessions"];
  for (const s of p.sessions) {
    out.push(`  ${s.date}  ${s.type.padEnd(14)} ${String(s.answers).padStart(2)} answers  ${s.score.toFixed(1)}/5`);
  }

  out.push("", "By competency (weakest first)");
  for (const c of p.competencies) {
    out.push(
      `  ${c.competency.padEnd(14)} ${c.average.toFixed(1)}/5  ${String(c.answers).padStart(2)} answers  ${trend(c.first, c.latest, c.answers)}`.trimEnd(),
    );
  }

  out.push("", "By dimension");
  for (const d of DIMENSIONS) {
    out.push(`  ${d.padEnd(14)} ${p.dimensions[d].toFixed(1)}/5${d === p.weakestDimension ? "  <- work on this" : ""}`);
  }
  out.push("", `Filler words: ${p.fillerRate} per 100 words on average`);
  return out.join("\n");
}
