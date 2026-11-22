import { averageScore } from "../../../src/coach.js";
import type { Round, Session, SessionSummary } from "./types.js";

/** Scorecard maths. Pure: no browser APIs. */

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

export const READY_AT = 80;

export function answered(session: Pick<Session, "rounds">): Round[] {
  return session.rounds.filter((r): r is Round => Boolean(r && r.attempts.length));
}

/** A question counts at its latest attempt: the retry is the point. */
export function roundScore(round: Round): number {
  return averageScore(round.attempts[round.attempts.length - 1].feedback);
}

/** 0-100: the mean answer score as a share of the 5-point maximum. */
export function readiness(rounds: Round[]): number {
  return rounds.length ? Math.round((mean(rounds.map(roundScore)) / 5) * 100) : 0;
}

export function bySkill(rounds: Round[]): Array<{ competency: string; score: number }> {
  const groups = new Map<string, number[]>();
  for (const r of rounds) {
    const key = r.competency.trim().toLowerCase() || "general";
    groups.set(key, [...(groups.get(key) ?? []), roundScore(r)]);
  }
  return [...groups.entries()]
    .map(([competency, scores]) => ({ competency, score: round1(mean(scores)) }))
    .sort((a, b) => b.score - a.score || a.competency.localeCompare(b.competency));
}

export function weakestSkill(rounds: Round[]): string | null {
  const skills = bySkill(rounds);
  return skills.length ? skills[skills.length - 1].competency : null;
}

export interface Delivery {
  wordsPerMinute: number;
  averageSeconds: number;
  fillersPer100: number;
  ownership: 'Mostly "I"' | 'Mostly "we"' | "Balanced" | null;
}

export function delivery(rounds: Round[]): Delivery {
  const finals = rounds.map((r) => r.attempts[r.attempts.length - 1]);
  const ratios = finals.map((a) => a.metrics.ownershipRatio).filter((x): x is number => x !== null);
  const ratio = ratios.length ? mean(ratios) : null;
  return {
    wordsPerMinute: Math.round(mean(finals.map((a) => a.pacing.wordsPerMinute).filter((w) => w > 0))),
    averageSeconds: Math.round(mean(finals.map((a) => a.pacing.durationSeconds))),
    fillersPer100: round1(mean(finals.map((a) => a.metrics.fillerRate))),
    ownership: ratio === null ? null : ratio >= 0.6 ? 'Mostly "I"' : ratio <= 0.4 ? 'Mostly "we"' : "Balanced",
  };
}

export function summarize(session: Session): SessionSummary {
  const rounds = answered(session);
  return {
    id: session.id,
    date: session.startedAt,
    role: session.role,
    type: session.type,
    readiness: readiness(rounds),
    answers: rounds.length,
    skills: bySkill(rounds),
  };
}

/** Readiness of the most recent earlier session for the same role and interview type. */
export function previousReadiness(history: SessionSummary[], current: SessionSummary): number | null {
  const earlier = history
    .filter((h) => h.id !== current.id && h.type === current.type && h.role.toLowerCase() === current.role.toLowerCase())
    .sort((a, b) => b.date.localeCompare(a.date));
  return earlier.length ? earlier[0].readiness : null;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/-/g, " ");
}
