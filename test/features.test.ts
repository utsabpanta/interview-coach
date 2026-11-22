import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Feedback } from "../src/coach.js";
import type { LLM, ToolSpec } from "../src/llm.js";
import { analyzeDelivery } from "../src/metrics.js";
import { runMock, type IO } from "../src/mock.js";
import { checkDeck, planDeck, renderDeck, renderStoryline, writeDoc, type Deck } from "../src/pipeline.js";
import { renderProgress, summarize } from "../src/progress.js";
import { loadSessions, renderFeedback, saveSession, type Round, type Session } from "../src/session.js";
import { analyzePacing, parseTranscript } from "../src/voice.js";

function feedback(structure: number, specificity: number, relevance: number, concision: number): Feedback {
  return { scores: { structure, specificity, relevance, concision }, strengths: ["s"], improvements: ["i"], rewrite: "r" };
}

function round(competency: string, f: Feedback): Round {
  const answer = "I did the thing.";
  return { competency, exchanges: [{ question: "Q?", answer }], feedback: f, metrics: analyzeDelivery(answer) };
}

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("progress", () => {
  const sessions: Session[] = [
    { type: "behavioral", startedAt: new Date("2026-11-01T10:00:00Z"), rounds: [round("conflict", feedback(2, 2, 2, 2)), round("failure", feedback(4, 4, 4, 4))] },
    { type: "behavioral", startedAt: new Date("2026-11-08T10:00:00Z"), rounds: [round("Conflict", feedback(4, 2, 4, 4))] },
    { type: "technical", startedAt: new Date("2026-11-09T10:00:00Z"), rounds: [] },
  ];

  it("aggregates by competency and dimension", () => {
    const p = summarize(sessions);
    expect(p.totalAnswers).toBe(3);
    expect(p.sessions).toHaveLength(2);
    // Competency labels are matched case-insensitively and listed weakest first.
    expect(p.competencies).toEqual([
      { competency: "conflict", answers: 2, average: 2.8, first: 2, latest: 3.5 },
      { competency: "failure", answers: 1, average: 4, first: 4, latest: 4 },
    ]);
    expect(p.dimensions.specificity).toBe(2.7);
    expect(p.weakestDimension).toBe("specificity");
  });

  it("renders trends and an empty state", () => {
    const text = renderProgress(summarize(sessions));
    expect(text).toContain("3 answers across 2 sessions");
    expect(text).toMatch(/conflict\s+2\.8\/5\s+2 answers\s+up 1\.5/);
    expect(text).toMatch(/specificity\s+2\.7\/5\s+<- work on this/);
    expect(renderProgress(summarize([]))).toContain("No saved sessions yet");
  });

  it("round-trips sessions through disk and skips malformed files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "coach-test-"));
    dirs.push(dir);
    await saveSession(sessions[1], dir);
    await saveSession(sessions[0], dir);
    await writeFile(path.join(dir, "junk.json"), "{not json", "utf8");
    await writeFile(path.join(dir, "other.json"), JSON.stringify({ hello: 1 }), "utf8");

    const loaded = await loadSessions(dir);
    expect(loaded.map((s) => s.startedAt.toISOString())).toEqual(["2026-11-01T10:00:00.000Z", "2026-11-08T10:00:00.000Z"]);
    expect(summarize(loaded)).toEqual(summarize(sessions));
    expect(await loadSessions(path.join(dir, "missing"))).toEqual([]);
  });
});

describe("voice pacing", () => {
  const words = (n: number) => Array(n).fill("word").join(" ");

  it("computes words per minute and long pauses from timestamps", () => {
    const p = analyzePacing({
      text: words(150),
      duration: 60,
      segments: [
        { start: 0, end: 20, text: "" },
        { start: 23.5, end: 40, text: "" },
        { start: 40.5, end: 60, text: "" },
      ],
    });
    expect(p).toMatchObject({ durationSeconds: 60, wordsPerMinute: 150, longPauses: 1, longestPauseSeconds: 3.5 });
    expect(p.notes).toEqual(["1 long pause (longest 3.5s)."]);
  });

  it("flags fast, slow, short, and long answers", () => {
    expect(analyzePacing({ text: words(400), duration: 120, segments: [] }).notes[0]).toMatch(/^Fast pace \(200 wpm\)/);
    expect(analyzePacing({ text: words(100), duration: 90, segments: [] }).notes[0]).toMatch(/^Slow pace \(67 wpm\)/);
    expect(analyzePacing({ text: words(50), duration: 20, segments: [] }).notes[0]).toMatch(/^Short/);
    expect(analyzePacing({ text: words(600), duration: 240, segments: [] }).notes[0]).toMatch(/^Long/);
    expect(analyzePacing({ text: words(600), duration: 240, segments: [] }, "system-design").notes).toEqual([]);
  });

  it("normalizes transcription responses", () => {
    const t = parseTranscript({ text: " Hello there. ", segments: [{ start: 0, end: 1.5, text: " Hello there." }, { bad: true }] });
    expect(t).toEqual({ text: "Hello there.", duration: 1.5, segments: [{ start: 0, end: 1.5, text: "Hello there." }] });
    expect(() => parseTranscript({})).toThrow(/empty/);
  });

  it("uses measured timing in feedback when a recording exists", () => {
    const text = "I fixed it.";
    const pacing = analyzePacing({ text, duration: 20, segments: [] });
    const out = renderFeedback(feedback(3, 3, 3, 3), analyzeDelivery(text), pacing);
    expect(out).toContain("3 words in 20s (9 wpm)");
    // The measured "Short" note replaces the estimated one rather than doubling up.
    expect(out.match(/Short:/g)).toHaveLength(1);
  });
});

describe("story rehearsal", () => {
  it("targets stories, reveals them after the answer, and passes them to evaluation", async () => {
    const prompts: Record<string, string> = {};
    const llm: LLM = {
      async text() {
        return "And your role?";
      },
      async structured<T>(_s: string, user: string, tool: ToolSpec): Promise<T> {
        prompts[tool.name] = user;
        if (tool.name === "interview_plan") {
          expect(JSON.stringify(tool.schema)).toContain('"story"');
          return { questions: [{ question: "Tell me about a hard migration.", competency: "delivery", story: "The Postgres migration" }] } as T;
        }
        return feedback(4, 4, 4, 4) as T;
      },
    };
    const said: string[] = [];
    const answers = ["We migrated the database."];
    const io: IO = { say: (t) => void said.push(t), ask: async () => answers.shift() ?? null };

    const session = await runMock(
      llm,
      io,
      { type: "behavioral", stories: "## The Postgres migration\n...", storyFocus: "Postgres" },
      { count: 1, followUps: false },
    );

    expect(session.rounds[0].story).toBe("The Postgres migration");
    expect(prompts.interview_plan).toContain('Only target stories matching "Postgres"');
    expect(prompts.answer_feedback).toContain('prepared the story titled "The Postgres migration"');
    const question = said.findIndex((t) => t.includes("hard migration"));
    const reveal = said.findIndex((t) => t.includes("Target story: The Postgres migration"));
    expect(said[question]).not.toContain("Postgres migration");
    expect(reveal).toBeGreaterThan(question);
  });
});

describe("doc-to-deck pipeline", () => {
  const deck: Deck = {
    title: "Cache rollout",
    slides: [
      { title: "Caching cut p99 latency by 40%", points: ["p99 fell from 500ms to 300ms"], visual: "Latency before and after", notes: "Lead with the result. --> then pause" },
      { title: "Results", points: ["a", "b", "c", "d", "e"], notes: "" },
    ],
  };

  it("renders Marp Markdown with notes as comments", () => {
    const md = renderDeck(deck);
    expect(md.startsWith('---\nmarp: true\ntitle: "Cache rollout"\n---\n')).toBe(true);
    expect(md).toContain("## Caching cut p99 latency by 40%\n\n- p99 fell from 500ms to 300ms\n\n> Visual: Latency before and after");
    expect(md).toContain("<!-- Lead with the result. -> then pause -->");
    expect(md.split("\n---\n")).toHaveLength(4);
    expect(renderStoryline(deck)).toBe(" 1. Caching cut p99 latency by 40%\n 2. Results");
  });

  it("flags label titles, crowded slides, and missing notes", () => {
    expect(checkDeck(deck)).toEqual([
      'Slide 2: title "Results" reads as a label; state the conclusion.',
      "Slide 2: 5 points; cut to 3.",
      "Slide 2: no speaker notes.",
    ]);
  });

  it("drafts, critiques, then revises a document", async () => {
    const seen: string[] = [];
    const llm: LLM = {
      async text(_s, user) {
        seen.push(user);
        return ["DRAFT", "1. Vague claim.", "FINAL\nTODO: add the error rate."][seen.length - 1];
      },
      async structured<T>(): Promise<T> {
        return { title: "T", slides: [deck.slides[0], deck.slides[1], deck.slides[0]] } as T;
      },
    };
    const result = await writeDoc(llm, "notes", "adr", "platform team");
    expect(result).toEqual({ doc: "FINAL\nTODO: add the error rate.", critique: "1. Vague claim." });
    expect(seen[0]).toContain("architecture decision record");
    expect(seen[1]).toContain("<draft>\nDRAFT\n</draft>");
    expect(seen[2]).toContain("<review>\n1. Vague claim.\n</review>");

    // Extra slides beyond the requested count are dropped.
    expect((await planDeck(llm, "doc", { slides: 2 })).slides).toHaveLength(2);
  });
});
