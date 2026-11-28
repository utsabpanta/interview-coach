import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A stand-in for the browser's speech recognizer, to exercise what happens
 * when a dictation session ends or fails partway through an answer.
 */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static failStart = 0;
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  start() {
    if (FakeRecognition.failStart > 0) {
      FakeRecognition.failStart -= 1;
      throw new Error("InvalidStateError");
    }
    this.started = true;
    FakeRecognition.instances.push(this);
  }
  stop() {
    this.onend?.();
  }
  abort() {}
  hear(text: string) {
    this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal: true }] });
  }
  /** The browser ends the session, as it does after about a minute or on an error. */
  end(error?: string) {
    if (error) this.onerror?.({ error });
    this.onend?.();
  }
}

const latest = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];

describe("speech recognition that keeps going", () => {
  let createRecognizer: typeof import("../src/lib/speech.js").createRecognizer;
  let heard: string[];
  let blocked: string[];

  beforeEach(async () => {
    vi.useFakeTimers();
    FakeRecognition.instances = [];
    FakeRecognition.failStart = 0;
    const g = globalThis as Record<string, unknown>;
    g.window = globalThis;
    g.SpeechRecognition = FakeRecognition;
    ({ createRecognizer } = await import("../src/lib/speech.js"));
    heard = [];
    blocked = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const make = (initial = "") =>
    createRecognizer(
      (finalText) => void heard.push(finalText),
      (reason) => void blocked.push(reason),
      initial,
    );

  it("starts a new session when the browser ends one, and keeps every word", () => {
    const rec = make();
    rec.start();
    latest().hear("I rebuilt the billing pipeline");
    // About a minute in, the browser ends the session on its own.
    latest().end();
    vi.runOnlyPendingTimers();
    expect(FakeRecognition.instances).toHaveLength(2);
    latest().hear("and shipped it in six weeks");
    expect(heard[heard.length - 1]).toBe("I rebuilt the billing pipeline and shipped it in six weeks");
    expect(blocked).toEqual([]);
  });

  it("rides out a passing network error instead of giving up on voice", () => {
    const rec = make();
    rec.start();
    latest().hear("So the first thing I did");
    latest().end("network");
    vi.runOnlyPendingTimers();
    latest().end("network");
    vi.runOnlyPendingTimers();
    expect(blocked).toEqual([]);
    latest().hear("was check the dashboards");
    expect(heard[heard.length - 1]).toBe("So the first thing I did was check the dashboards");
    // Hearing words again clears the count, so later hiccups get the same patience.
    for (let i = 0; i < 4; i++) {
      latest().end("network");
      vi.runOnlyPendingTimers();
    }
    expect(blocked).toEqual([]);
  });

  it("says so, once, when voice really has stopped working", () => {
    const rec = make();
    rec.start();
    latest().hear("My answer so far");
    for (let i = 0; i < 6; i++) {
      latest().end("network");
      vi.runOnlyPendingTimers();
    }
    expect(blocked).toEqual(["Speech recognition keeps stopping. Type your answer instead; what you said so far is kept."]);
    const count = FakeRecognition.instances.length;
    vi.runAllTimers();
    expect(FakeRecognition.instances).toHaveLength(count);
  });

  it("tries again when a restart is refused", () => {
    const rec = make();
    rec.start();
    FakeRecognition.failStart = 2;
    latest().end();
    vi.runAllTimers();
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(blocked).toEqual([]);
  });

  it("silence and deliberate stops are not failures", () => {
    const rec = make();
    rec.start();
    for (let i = 0; i < 8; i++) {
      latest().end("no-speech");
      vi.runOnlyPendingTimers();
    }
    expect(blocked).toEqual([]);
    const count = FakeRecognition.instances.length;
    rec.stop();
    vi.runAllTimers();
    expect(FakeRecognition.instances).toHaveLength(count);
  });

  it("reports a blocked microphone straight away", () => {
    const rec = make();
    rec.start();
    latest().end("not-allowed");
    vi.runAllTimers();
    expect(blocked).toEqual(["Microphone access was blocked. Allow it in your browser, or type your answer."]);
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it("carries on from words said earlier in the turn", () => {
    const rec = make("I owned the rollout");
    rec.start();
    latest().hear("and I led the review");
    expect(heard[heard.length - 1]).toBe("I owned the rollout and I led the review");
  });
});
