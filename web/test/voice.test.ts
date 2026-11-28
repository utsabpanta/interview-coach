import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/lib/store.js";
import { rankVoices, splitForSpeech, voiceScore } from "../src/lib/voice.js";

describe("splitForSpeech", () => {
  it("splits into sentences and keeps every word", () => {
    const text = "Hi, I'm the hiring manager for this role. We'll talk through a few topics. Walk me through a recent project you owned end to end. What did you build, and which decisions were yours?";
    const chunks = splitForSpeech(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ")).toBe(text);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(180);
  });

  it("joins a short trailing sentence to the one before", () => {
    expect(splitForSpeech("Thanks, that gives me a clear picture. Let's move on.")).toEqual(["Thanks, that gives me a clear picture. Let's move on."]);
  });

  it("breaks one very long sentence at commas or spaces without losing text", () => {
    const long = `${Array(30).fill("first we looked at the dashboards").join(", ")}.`;
    const chunks = splitForSpeech(long);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(180);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  it("handles empty and unpunctuated text", () => {
    expect(splitForSpeech("   ")).toEqual([]);
    expect(splitForSpeech("no punctuation here")).toEqual(["no punctuation here"]);
  });
});

describe("choosing a browser voice", () => {
  const v = (name: string, lang = "en-US") => ({ name, lang, voiceURI: name });

  it("prefers neural voices, then Chrome's network voices, then good system voices", () => {
    const ranked = rankVoices([
      v("Fred"),
      v("Microsoft David - English (United States)"),
      v("Samantha"),
      v("Google US English"),
      v("Microsoft Aria Online (Natural) - English (United States)"),
      v("Google español", "es-ES"),
      v("Ava (Premium)"),
      v("Daniel", "en-GB"),
    ]).map((x) => x.name);

    expect(ranked).toEqual([
      "Microsoft Aria Online (Natural) - English (United States)",
      "Google US English",
      "Ava (Premium)",
      "Samantha",
      "Daniel",
      "Microsoft David - English (United States)",
      "Fred",
    ]);
  });

  it("leaves out other languages and ranks novelty voices last", () => {
    expect(voiceScore(v("Google français", "fr-FR"))).toBe(-1);
    expect(voiceScore(v("Zarvox"))).toBeLessThan(voiceScore(v("Some Unknown Voice")));
  });

  it("defaults to the free browser voice", () => {
    expect(DEFAULT_SETTINGS.voice).toEqual({ engine: "browser", browserVoice: "", groqVoice: "hannah" });
  });
});
