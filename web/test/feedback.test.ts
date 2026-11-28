import { describe, expect, it } from "vitest";
import { findPack, PACKS, packsFor } from "../src/lib/packs.js";
import { annotate, fillerBreakdown } from "../src/lib/score.js";

describe("coaching points on the transcript", () => {
  const answer = "Last year we rebuilt the billing pipeline. I made the call to pause it for two weeks.";

  it("highlights the exact words each point quotes", () => {
    const { segments, shown } = annotate(answer, [
      { quote: "I made the call to pause", note: "Strong." },
      { quote: "We rebuilt", note: "Say what you did." },
    ]);
    expect(segments).toEqual([
      { text: "Last year " },
      { text: "we rebuilt", point: 1 },
      { text: " the billing pipeline. " },
      { text: "I made the call to pause", point: 2 },
      { text: " it for two weeks." },
    ]);
    expect(segments.map((s) => s.text).join("")).toBe(answer);
    // Numbered and listed in the order they appear in the answer.
    expect(shown.map((n) => [n.point, n.note])).toEqual([
      [1, "Say what you did."],
      [2, "Strong."],
    ]);
  });

  it("never shows a point that quotes words the candidate did not say", () => {
    const { segments, shown } = annotate(answer, [{ quote: "we decided to cancel", note: "Invented." }]);
    expect(segments).toEqual([{ text: answer }]);
    expect(shown).toEqual([]);
  });

  it("ignores quotation marks and trailing punctuation around a quote, and overlapping points", () => {
    const { shown } = annotate(answer, [
      { quote: '"the billing pipeline."', note: "A." },
      { quote: "billing pipeline", note: "Overlaps the first." },
      { quote: "x", note: "Too short." },
    ]);
    expect(shown).toEqual([{ quote: '"the billing pipeline."', note: "A.", point: 1 }]);
  });

  it("handles an answer with no points", () => {
    expect(annotate("", [])).toEqual({ segments: [{ text: "" }], shown: [] });
  });
});

describe("filler word breakdown", () => {
  it("lists the most frequent first", () => {
    expect(fillerBreakdown({ "you know": 2, um: 3, like: 2 })).toBe("um ×3, like ×2, you know ×2");
    expect(fillerBreakdown({})).toBe("");
  });
});

describe("question packs in the app", () => {
  it("bundles the repository's packs", () => {
    expect(PACKS.length).toBeGreaterThanOrEqual(5);
    expect(PACKS.map((p) => p.id)).toContain("backend-engineer");
  });

  it("offers only packs that cover the chosen round", () => {
    expect(packsFor("system-design").every((p) => p.types.includes("system-design"))).toBe(true);
    expect(packsFor("system-design").map((p) => p.id)).not.toContain("product-manager");
    expect(findPack("product-manager", "behavioral")?.name).toBe("Product manager");
    expect(findPack("product-manager", "system-design")).toBeUndefined();
    expect(findPack(undefined, "behavioral")).toBeUndefined();
  });
});
