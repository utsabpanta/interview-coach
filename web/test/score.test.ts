import { beforeEach, describe, expect, it } from "vitest";
import type { Feedback } from "../../src/coach.js";
import { analyzeDelivery } from "../../src/metrics.js";
import { analyzePacing } from "../../src/pacing.js";
import {
  answered,
  bySkill,
  clock,
  delivery,
  enoughToJudge,
  firstScore,
  previousReadiness,
  readiness,
  retryGain,
  roleKey,
  roundScore,
  saidByCandidate,
  summarize,
  weakestSkill,
} from "../src/lib/score.js";
import { shareHeadline } from "../src/lib/shareCard.js";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../src/lib/store.js";
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

describe("practice score", () => {
  const rounds = [round("conflict", 4), round("ownership", 3, 5), round("Ambiguity", 2), round("ambiguity", 3)];

  it("counts first attempts, because a retry comes after the feedback", () => {
    expect(firstScore(rounds[1])).toBe(3);
    expect(roundScore(rounds[1])).toBe(5);
    // (4 + 3 + 2 + 3) / 4 = 3 of 5
    expect(readiness(rounds)).toBe(60);
    expect(readiness([])).toBe(0);
  });

  it("reports what retries added, separately", () => {
    // One retry went from 3 to 5: two fifths of the scale.
    expect(retryGain(rounds)).toBe(40);
    expect(retryGain([round("x", 4)])).toBeNull();
  });

  it("refuses to score a round that was mostly skipped", () => {
    expect(enoughToJudge(1, 5)).toBe(false);
    expect(enoughToJudge(2, 5)).toBe(false);
    expect(enoughToJudge(3, 5)).toBe(true);
    expect(enoughToJudge(3, 8)).toBe(false);
    // A three-question drill needs all three; a two-topic round needs both.
    expect(enoughToJudge(3, 3)).toBe(true);
    expect(enoughToJudge(2, 3)).toBe(false);
    expect(enoughToJudge(2, 2)).toBe(true);
  });

  it("groups skills case-insensitively, strongest first", () => {
    expect(bySkill(rounds)).toEqual([
      { competency: "conflict", score: 4 },
      { competency: "ownership", score: 3 },
      { competency: "ambiguity", score: 2.5 },
    ]);
    expect(weakestSkill(rounds)).toBe("ambiguity");
    expect(weakestSkill([])).toBeNull();
  });

  it("summarizes delivery from first attempts", () => {
    const d = delivery([{ question: "Q?", competency: "x", attempts: [attempt(3, "We did it. We shipped. We won. We left. I helped.", 30)] }]);
    expect(d).toEqual({ wordsPerMinute: 22, averageSeconds: 30, fillersPer100: 0, ownership: 'Mostly "we"' });
  });

  it("ignores skipped questions", () => {
    const session = { rounds: [rounds[0], undefined, { ...rounds[2], attempts: [] }] } as Pick<Session, "rounds">;
    expect(answered(session)).toEqual([rounds[0]]);
  });
});

describe("comparing with an earlier session", () => {
  const base: SessionSummary = { id: "c", date: "2026-11-22T10:00:00Z", role: "Senior Backend Engineer", type: "behavioral", readiness: 72, answers: 5, planned: 5, skills: [] };

  it("only compares like with like", () => {
    const history: SessionSummary[] = [
      { ...base, id: "a", date: "2026-11-01T10:00:00Z", readiness: 50 },
      { ...base, id: "b", date: "2026-11-15T10:00:00Z", role: "Sr. Backend Engineer", readiness: 63 },
      { ...base, id: "drill", date: "2026-11-18T10:00:00Z", drill: "conflict", answers: 3, planned: 3, readiness: 95 },
      { ...base, id: "thin", date: "2026-11-19T10:00:00Z", answers: 1, readiness: 100 },
      { ...base, id: "x", date: "2026-11-20T10:00:00Z", type: "technical", readiness: 90 },
      { ...base, id: "y", date: "2026-11-21T10:00:00Z", role: "Designer", readiness: 10 },
      { ...base, id: "future", date: "2026-11-23T10:00:00Z", readiness: 99 },
      base,
    ];
    // The abbreviated title matches; the drill, the one-answer session, and other roles do not.
    expect(previousReadiness(history, base)).toBe(63);
    expect(previousReadiness([base], base)).toBeNull();
    // A drill is compared only with an earlier drill on the same skill.
    const drill = { ...base, id: "d2", drill: "conflict", answers: 3, planned: 3 };
    expect(previousReadiness(history, drill)).toBe(95);
    expect(previousReadiness(history, { ...drill, drill: "failure" })).toBeNull();
  });

  it("treats abbreviated titles as the same role", () => {
    expect(roleKey("Sr. Backend Engineer")).toBe(roleKey("senior backend engineer"));
    expect(roleKey("Jr Designer")).toBe("junior designer");
  });

  it("words the share line as a comparison between sessions", () => {
    expect(shareHeadline(72, 63)).toBe("Up from 63 to 72 since my last session");
    expect(shareHeadline(72, null)).toBe("Practice score: 72 / 100");
    expect(shareHeadline(60, 63)).toBe("Practice score: 60 / 100");
  });

  it("keeps scores and the role, never answers or the posting", () => {
    const session: Session = {
      id: "s1",
      startedAt: "2026-11-22T10:00:00Z",
      role: "Backend Engineer",
      intro: "",
      type: "behavioral",
      setup: { jobDescription: "secret posting", resume: "", type: "behavioral" },
      drill: "conflict",
      plan: [
        { question: "a", competency: "x" },
        { question: "b", competency: "x" },
        { question: "c", competency: "x" },
      ],
      index: 0,
      rounds: [round("conflict", 4), undefined, round("conflict", 2)],
    };
    const summary = summarize(session);
    expect(summary).toMatchObject({ id: "s1", readiness: 60, answers: 2, planned: 3, drill: "conflict", role: "Backend Engineer" });
    expect(JSON.stringify(summary)).not.toContain("secret posting");
    expect(JSON.stringify(summary)).not.toContain("migration");
  });
});

describe("quoting the candidate", () => {
  const exchanges = [
    { question: "Q?", answer: "So, we decided to pause the migration." },
    { question: "And?", answer: "Then I re-planned it." },
  ];

  it("accepts only words the candidate actually said", () => {
    expect(saidByCandidate("we decided", exchanges)).toBe(true);
    expect(saidByCandidate("We decided to pause the migration", exchanges)).toBe(true);
    expect(saidByCandidate("I re-planned it", exchanges)).toBe(true);
    expect(saidByCandidate("a phrase the candidate never said", exchanges)).toBe(false);
    expect(saidByCandidate("we decided to cancel", exchanges)).toBe(false);
    expect(saidByCandidate("", exchanges)).toBe(false);
    expect(saidByCandidate(undefined, exchanges)).toBe(false);
  });

  it("does not accept the interviewer's words as the candidate's", () => {
    expect(saidByCandidate("And", [{ question: "And what happened next", answer: "It shipped." }])).toBe(false);
  });
});

describe("where API keys are kept", () => {
  const stores: Record<string, Map<string, string>> = {};
  beforeEach(() => {
    for (const name of ["localStorage", "sessionStorage"]) {
      const data = new Map<string, string>();
      stores[name] = data;
      (globalThis as Record<string, unknown>)[name] = {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      };
    }
  });

  it("remembers keys on the device by default", () => {
    saveSettings({ ...DEFAULT_SETTINGS, keys: { groq: "gsk_1" } });
    expect([...stores.localStorage.values()].join()).toContain("gsk_1");
    expect(stores.sessionStorage.size).toBe(0);
    expect(loadSettings().keys.groq).toBe("gsk_1");
  });

  it("keeps keys only for the tab when asked not to remember them", () => {
    saveSettings({ ...DEFAULT_SETTINGS, rememberKeys: false, keys: { groq: "gsk_2" } });
    expect([...stores.localStorage.values()].join()).not.toContain("gsk_2");
    expect([...stores.sessionStorage.values()].join()).toContain("gsk_2");
    // Still usable in this tab, and gone once the tab's storage is cleared.
    expect(loadSettings()).toMatchObject({ rememberKeys: false, keys: { groq: "gsk_2" } });
    stores.sessionStorage.clear();
    expect(loadSettings().keys).toEqual({});
  });

  it("removes keys everywhere when they are cleared", () => {
    saveSettings({ ...DEFAULT_SETTINGS, keys: { groq: "gsk_3" } });
    saveSettings({ ...DEFAULT_SETTINGS, keys: {} });
    expect([...stores.localStorage.values()].join()).not.toContain("gsk_3");
    expect(loadSettings().keys).toEqual({});
  });
});

describe("formatting", () => {
  it("formats clocks", () => {
    expect(clock(84)).toBe("1:24");
    expect(clock(0)).toBe("0:00");
  });
});
