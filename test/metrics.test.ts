import { describe, expect, it } from "vitest";
import { analyzeDelivery, countWords } from "../src/metrics.js";

describe("countWords", () => {
  it("counts whitespace-separated words", () => {
    expect(countWords("  one two\nthree  ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});

describe("analyzeDelivery", () => {
  it("counts filler words and computes a rate", () => {
    const m = analyzeDelivery("Um, so I basically, you know, fixed it. Uh, it was, like, hard.");
    expect(m.fillers).toEqual({ um: 1, uh: 1, "you know": 1, basically: 1, like: 1 });
    expect(m.fillerCount).toBe(5);
    expect(m.fillerRate).toBeGreaterThan(3);
    expect(m.notes.some((n) => n.includes("Filler"))).toBe(true);
  });

  it("does not treat the verb 'like' as a filler", () => {
    expect(analyzeDelivery("I like databases and things like queues.").fillerCount).toBe(0);
  });

  it("flags answers that are too short or too long for the type", () => {
    expect(analyzeDelivery("I fixed the bug.").notes[0]).toMatch(/^Short/);
    const long = Array(500).fill("word").join(" ");
    expect(analyzeDelivery(long).notes[0]).toMatch(/^Long/);
    // 500 words is about 3.6 minutes, which is fine for system design.
    expect(analyzeDelivery(long, "system-design").notes).toEqual([]);
  });

  it("flags 'we'-heavy behavioral answers", () => {
    const m = analyzeDelivery("We planned it. We built it. We shipped it. We measured it. I helped.");
    expect(m.ownershipRatio).toBe(0.2);
    expect(m.notes.some((n) => n.includes('"we"'))).toBe(true);
  });

  it("handles empty input", () => {
    const m = analyzeDelivery("");
    expect(m).toMatchObject({ words: 0, fillerCount: 0, fillerRate: 0, ownershipRatio: null, notes: [] });
  });
});
