import { describe, expect, it } from "vitest";
import type { Feedback } from "../../src/coach.js";
import { analyzeDelivery } from "../../src/metrics.js";
import { analyzePacing } from "../../src/pacing.js";
import { answered, bySkill, clock, delivery, previousReadiness, readiness, roundScore, summarize, weakestSkill } from "../src/lib/score.js";
import { shareHeadline } from "../src/lib/shareCard.js";
import type { Attempt, Round, Session, SessionSummary } from "../src/lib/types.js";

function attempt(score: number, text = "I led the migration and I shipped it.", duration = 60): Attempt {
  const feedback: Feedback = {
    scores: { structure: score, specificity: score, relevance: score, concision: score },
    strengths: [],
    improvements: [],
    rewrite: "",
  };
  return {
    exchanges: [{ question: "Q?", answer: text }],
    feedback,
    metrics: analyzeDelivery(text),
    pacing: analyzePacing({ text, duration, segments: [] }),
  };
}

const round = (competency: string, ...scores: number[]): Round => ({ question: "Q?", competency, attempts: scores.map((s) => attempt(s)) });

describe("scorecard maths", () => {
  const rounds = [round("conflict", 4), round("ownership", 3, 4), round("Ambiguity", 2), round("ambiguity", 3)];

  it("scores a question at its latest attempt", () => {
    expect(roundScore(rounds[1])).toBe(4);
  });

  it("computes readiness as a share of the maximum", () => {
    // (4 + 4 + 2 + 3) / 4 = 3.25 of 5
    expect(readiness(rounds)).toBe(65);
    expect(readiness([])).toBe(0);
  });

  it("groups skills case-insensitively, strongest first", () => {
    expect(bySkill(rounds)).toEqual([
      { competency: "conflict", score: 4 },
      { competency: "ownership", score: 4 },
      { competency: "ambiguity", score: 2.5 },
    ]);
    expect(weakestSkill(rounds)).toBe("ambiguity");
    expect(weakestSkill([])).toBeNull();
  });

  it("summarizes delivery from final attempts", () => {
    const d = delivery([{ question: "Q?", competency: "x", attempts: [attempt(3, "We did it. We shipped. We won. We left. I helped.", 30)] }]);
    expect(d).toEqual({ wordsPerMinute: 22, averageSeconds: 30, fillersPer100: 0, ownership: 'Mostly "we"' });
  });

  it("ignores skipped questions", () => {
    const session = { rounds: [rounds[0], undefined, { ...rounds[2], attempts: [] }] } as Pick<Session, "rounds">;
    expect(answered(session)).toEqual([rounds[0]]);
  });

  it("finds the previous session for the same role and type", () => {
    const base: SessionSummary = { id: "c", date: "2026-11-22T10:00:00Z", role: "Backend Engineer", type: "behavioral", readiness: 72, answers: 5, skills: [] };
    const history: SessionSummary[] = [
      { ...base, id: "a", date: "2026-11-01T10:00:00Z", readiness: 50 },
      { ...base, id: "b", date: "2026-11-15T10:00:00Z", role: "backend engineer", readiness: 63 },
      { ...base, id: "x", date: "2026-11-20T10:00:00Z", type: "technical", readiness: 90 },
      { ...base, id: "y", date: "2026-11-21T10:00:00Z", role: "Designer", readiness: 10 },
      base,
    ];
    expect(previousReadiness(history, base)).toBe(63);
    expect(previousReadiness([base], base)).toBeNull();
  });

  it("summarizes a session without keeping answers", () => {
    const session: Session = {
      id: "s1",
      startedAt: "2026-11-22T10:00:00Z",
      role: "Backend Engineer",
      type: "behavioral",
      setup: { jobDescription: "secret posting", resume: "", type: "behavioral" },
      plan: [],
      index: 0,
      rounds,
    };
    const summary = summarize(session);
    expect(summary).toMatchObject({ id: "s1", readiness: 65, answers: 4, role: "Backend Engineer" });
    expect(JSON.stringify(summary)).not.toContain("secret posting");
    expect(JSON.stringify(summary)).not.toContain("migration");
  });

  it("formats clocks and share headlines", () => {
    expect(clock(84)).toBe("1:24");
    expect(clock(0)).toBe("0:00");
    expect(shareHeadline(72, 63)).toBe("63 to 72 in one session");
    expect(shareHeadline(72, null)).toBe("Interview readiness: 72 / 100");
    expect(shareHeadline(60, 63)).toBe("Interview readiness: 60 / 100");
  });
});
