import { averageScore, type CoachingNote, type Exchange } from "../../../src/coach.js";
import type { Round, Session, SessionSummary } from "./types.js";

/**
 * Scorecard maths. Pure: no browser APIs.
 *
 * These numbers come from one model's judgment of a few answers. They are a
 * practice guide, so the code avoids anything that would make them look like
 * more than that: no score is shown from too little evidence, retries (taken
 * after seeing the feedback) do not raise the headline number, and progress is
 * only compared between sessions of the same kind.
 */

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Fewer answered topics than this is too little to put a number on. */
export const MIN_TOPICS = 3;

export function answered(session: Pick<Session, "rounds">): Round[] {
  return session.rounds.filter((r): r is Round => Boolean(r && r.attempts.length));
}

/** The first attempt: what the candidate said before seeing any feedback. */
export function firstScore(round: Round): number {
  return averageScore(round.attempts[0].feedback);
}

/** The latest attempt, after any retries. */
export function roundScore(round: Round): number {
  return averageScore(round.attempts[round.attempts.length - 1].feedback);
}

/**
 * 0-100: the mean first-attempt score as a share of the 5-point maximum.
 * First attempts are used because a retry comes after reading the feedback
 * and a model-written better answer, so it says little about readiness.
 */
export function readiness(rounds: Round[]): number {
  return rounds.length ? Math.round((mean(rounds.map(firstScore)) / 5) * 100) : 0;
}

/** How much retries improved on first attempts, in readiness points; null if nothing was retried. */
export function retryGain(rounds: Round[]): number | null {
  const retried = rounds.filter((r) => r.attempts.length > 1);
  if (retried.length === 0) return null;
  return Math.round((mean(retried.map((r) => roundScore(r) - firstScore(r))) / 5) * 100);
}

/** Whether enough of the round was answered for the number to mean anything. */
export function enoughToJudge(answeredTopics: number, plannedTopics: number): boolean {
  return answeredTopics >= Math.min(MIN_TOPICS, plannedTopics) && answeredTopics * 2 >= plannedTopics;
}

export function bySkill(rounds: Round[]): Array<{ competency: string; score: number }> {
  const groups = new Map<string, number[]>();
  for (const r of rounds) {
    const key = r.competency.trim().toLowerCase() || "general";
    groups.set(key, [...(groups.get(key) ?? []), firstScore(r)]);
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
  const firsts = rounds.map((r) => r.attempts[0]);
  const ratios = firsts.map((a) => a.metrics.ownershipRatio).filter((x): x is number => x !== null);
  const ratio = ratios.length ? mean(ratios) : null;
  return {
    wordsPerMinute: Math.round(mean(firsts.map((a) => a.pacing.wordsPerMinute).filter((w) => w > 0))),
    averageSeconds: Math.round(mean(firsts.map((a) => a.pacing.durationSeconds))),
    fillersPer100: round1(mean(firsts.map((a) => a.metrics.fillerRate))),
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
    planned: session.plan.length,
    ...(session.drill ? { drill: session.drill } : {}),
    skills: bySkill(rounds),
  };
}

/** "Sr. Backend Engineer" and "Senior Backend Engineer" are the same job. */
export function roleKey(role: string): string {
  return role
    .toLowerCase()
    .replace(/\bsr\b\.?/g, "senior")
    .replace(/\bjr\b\.?/g, "junior")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Readiness of the most recent earlier session that is fair to compare with:
 * same role, same interview type, same kind (full round, or a drill on the
 * same skill), and itself answered fully enough to carry a number.
 */
export function previousReadiness(history: SessionSummary[], current: SessionSummary): number | null {
  const earlier = history
    .filter(
      (h) =>
        h.id !== current.id &&
        h.date < current.date &&
        h.type === current.type &&
        roleKey(h.role) === roleKey(current.role) &&
        (h.drill ?? "") === (current.drill ?? "") &&
        enoughToJudge(h.answers, h.planned ?? h.answers),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return earlier.length ? earlier[0].readiness : null;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True only if the candidate really said this, so nothing is put in their mouth. */
export function saidByCandidate(quote: string | undefined, exchanges: Exchange[]): boolean {
  const q = normalize(quote ?? "");
  if (q.length < 3) return false;
  return normalize(exchanges.map((e) => e.answer).join(" ")).includes(q);
}

export interface Segment {
  text: string;
  /** 1-based number of the coaching point this stretch of text belongs to. */
  point?: number;
}

/**
 * Splits an answer into plain and highlighted stretches, one highlight per
 * coaching point whose quote really appears in the answer. Points that quote
 * something the candidate did not say are not shown at all.
 */
export function annotate(answer: string, notes: CoachingNote[]): { segments: Segment[]; shown: Array<CoachingNote & { point: number }> } {
  const lower = answer.toLowerCase();
  const spans: Array<{ start: number; end: number; point: number; note: CoachingNote }> = [];
  notes.forEach((note, i) => {
    const quote = note.quote.trim().replace(/^["'\u201c]+|["'\u201d.,;:!?]+$/g, "");
    if (quote.length < 3) return;
    const start = lower.indexOf(quote.toLowerCase());
    if (start === -1) return;
    const end = start + quote.length;
    if (spans.some((s) => start < s.end && end > s.start)) return;
    spans.push({ start, end, point: i + 1, note });
  });
  spans.sort((a, b) => a.start - b.start);
  // Number the points in the order they appear, so the reader meets 1 before 2.
  spans.forEach((s, i) => (s.point = i + 1));

  const segments: Segment[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start > at) segments.push({ text: answer.slice(at, s.start) });
    segments.push({ text: answer.slice(s.start, s.end), point: s.point });
    at = s.end;
  }
  if (at < answer.length || segments.length === 0) segments.push({ text: answer.slice(at) });
  return { segments, shown: spans.map((s) => ({ ...s.note, point: s.point })) };
}

/** "um ×3, you know ×2", most frequent first; empty when there were none. */
export function fillerBreakdown(fillers: Record<string, number>): string {
  return Object.entries(fillers)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word, n]) => `${word} \u00d7${n}`)
    .join(", ");
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function titleCase(text: string): string {
  const spaced = text.replace(/-/g, " ");
  return (spaced.charAt(0).toUpperCase() + spaced.slice(1)).replace(/\bai\b/gi, "AI");
}
