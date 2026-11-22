import { useCallback, useEffect, useRef, useState } from "react";
import { evaluate, followUp, type Context, type Exchange } from "../../../src/coach.js";
import { analyzeDelivery, countWords, LENGTH_TARGETS } from "../../../src/metrics.js";
import { analyzePacing } from "../../../src/pacing.js";
import type { LLM } from "../../../src/types.js";
import { Header, Icon } from "../components.js";
import { explainError } from "../lib/llm.js";
import { clock, roundScore, titleCase } from "../lib/score.js";
import { createRecognizer, recognitionSupported, speak, useMicLevels, type Recognizer } from "../lib/speech.js";
import type { Attempt, Session, Settings } from "../lib/types.js";

type Phase = "asking" | "listening" | "paused" | "thinking" | "evaluating" | "failed";

const SPEAKING_WPM = 140;

export function Interview({
  session,
  settings,
  llm,
  previous,
  onComplete,
  onSkip,
  onEnd,
}: {
  session: Session;
  settings: Settings;
  llm: LLM;
  /** The earlier attempt, when this is a retry of the same question. */
  previous?: Attempt;
  onComplete: (attempt: Attempt) => void;
  onSkip: () => void;
  onEnd: () => void;
}) {
  const planned = session.plan[session.index];
  const ctx: Context = { type: session.type, jobDescription: session.setup.jobDescription || undefined, resume: session.setup.resume || undefined };

  const [phase, setPhase] = useState<Phase>("asking");
  const [prompt, setPrompt] = useState(planned.question);
  const [isFollowUp, setIsFollowUp] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [typing, setTyping] = useState(!recognitionSupported());
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const alive = useRef(true);
  const exchanges = useRef<Exchange[]>([]);
  const recognizer = useRef<Recognizer | null>(null);
  const cancelSpeech = useRef<() => void>(() => {});
  const typingRef = useRef(typing);
  typingRef.current = typing;
  const usedTyping = useRef(typing);

  const listen = useCallback(() => {
    if (!alive.current) return;
    setPhase("listening");
    if (!typingRef.current) recognizer.current?.start();
  }, []);

  const begin = useCallback(
    (text: string) => {
      recognizer.current?.stop();
      cancelSpeech.current();
      setPrompt(text);
      setFinalText("");
      setInterim("");
      setTyped("");
      recognizer.current = createRecognizer(
        (f, i) => {
          if (!alive.current) return;
          setFinalText(f);
          setInterim(i);
        },
        (reason) => {
          if (!alive.current) return;
          setNotice(reason);
          setTyping(true);
          usedTyping.current = true;
        },
      );
      if (settings.speakQuestions) {
        setPhase("asking");
        cancelSpeech.current = speak(text, listen);
      } else {
        listen();
      }
    },
    [listen, settings.speakQuestions],
  );

  useEffect(() => {
    alive.current = true;
    begin(planned.question);
    return () => {
      alive.current = false;
      recognizer.current?.stop();
      cancelSpeech.current();
    };
    // One mount per question attempt: the parent re-keys this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "listening") return;
    const started = Date.now();
    const base = seconds;
    const id = window.setInterval(() => setSeconds(base + (Date.now() - started) / 1000), 250);
    return () => window.clearInterval(id);
    // `seconds` is read once as the starting point for this stretch of listening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const levels = useMicLevels(phase === "listening" && !typing);
  const spoken = `${finalText} ${interim}`.trim();
  const current = typing ? typed.trim() : spoken;
  const allText = [...exchanges.current.map((e) => e.answer), current].join("\n").trim();
  const words = countWords(allText);
  const liveWpm = !usedTyping.current && seconds >= 8 ? Math.round(words / (seconds / 60)) : null;
  const fillers = analyzeDelivery(allText, session.type).fillerCount;

  const [minMin, maxMin] = LENGTH_TARGETS[session.type] ?? LENGTH_TARGETS.behavioral;
  const scale = maxMin * 60 * 1.25;

  const switchToTyping = () => {
    recognizer.current?.stop();
    setTyped(spoken);
    setTyping(true);
    usedTyping.current = true;
  };

  const evaluateNow = async () => {
    setPhase("evaluating");
    setNotice(null);
    try {
      const feedback = await evaluate(
        llm,
        ctx,
        exchanges.current,
        undefined,
        previous ? { answer: previous.exchanges.map((e) => e.answer).join("\n"), feedback: previous.feedback } : undefined,
      );
      if (!alive.current) return;
      const text = exchanges.current.map((e) => e.answer).join("\n");
      // Typing speed says nothing about speaking pace, so estimate from length instead.
      const duration = usedTyping.current ? (countWords(text) / SPEAKING_WPM) * 60 : seconds;
      const pacing = analyzePacing({ text, duration, segments: [] }, session.type);
      onComplete({
        exchanges: exchanges.current,
        feedback,
        metrics: analyzeDelivery(text, session.type),
        // A typed answer has a length estimate but no real pace.
        pacing: usedTyping.current ? { ...pacing, wordsPerMinute: 0, notes: pacing.notes.filter((n) => !/pace/i.test(n)) } : pacing,
      });
    } catch (err) {
      if (!alive.current) return;
      setNotice(explainError(err));
      setPhase("failed");
    }
  };

  const done = async () => {
    if (!current) {
      setNotice("Say or type an answer first.");
      return;
    }
    recognizer.current?.stop();
    cancelSpeech.current();
    setNotice(null);
    exchanges.current = [...exchanges.current, { question: prompt, answer: current }];

    if (!isFollowUp && settings.followUps && !previous) {
      setPhase("thinking");
      try {
        const probe = await followUp(llm, ctx, exchanges.current[0]);
        if (!alive.current) return;
        if (probe) {
          setIsFollowUp(true);
          begin(probe);
          return;
        }
      } catch {
        // A failed follow-up should not cost the candidate their answer.
      }
      if (!alive.current) return;
    }
    await evaluateNow();
  };

  const togglePause = () => {
    if (phase === "listening") {
      recognizer.current?.stop();
      setPhase("paused");
    } else if (phase === "paused") {
      listen();
    }
  };

  const hearAgain = () => {
    recognizer.current?.stop();
    setPhase("asking");
    cancelSpeech.current = speak(prompt, listen);
  };

  const skipSpeech = () => {
    cancelSpeech.current();
    listen();
  };

  const status =
    phase === "asking"
      ? "Interviewer is speaking"
      : phase === "listening"
        ? typing
          ? "Type your answer"
          : "Listening"
        : phase === "paused"
          ? "Paused"
          : phase === "thinking"
            ? "Interviewer is thinking"
            : phase === "evaluating"
              ? "Scoring your answer"
              : "Could not score that";
  const answering = phase === "listening" || phase === "paused";
  const busy = phase === "thinking" || phase === "evaluating";

  return (
    <div className="page">
      <Header subtitle={`${session.role}, ${session.drill ? `${session.drill} drill` : `${titleCase(session.type).toLowerCase()} round`}`} onHome={onEnd}>
        <button type="button" className="btn ghost small" onClick={onEnd}>
          End interview
        </button>
      </Header>

      <main className="split">
        <section className="split-main" aria-label="Current question">
          <div className="progress">
            <div className="progress-head">
              <p className="strong">
                Question {session.index + 1} of {session.plan.length}
                {previous ? <span className="muted"> · second attempt</span> : null}
              </p>
              <p className="muted small-text">Testing: {planned.competency}</p>
            </div>
            <div
              className="segments"
              role="img"
              aria-label={`Question ${session.index + 1} of ${session.plan.length}`}
              style={{ gridTemplateColumns: `repeat(${session.plan.length}, minmax(0, 1fr))` }}
            >
              {session.plan.map((_, i) => (
                <div key={i} className={i <= session.index ? "segment on" : "segment"} />
              ))}
            </div>
          </div>

          <div className="question">
            <p className="eyebrow muted">{isFollowUp ? "Follow-up" : "Interviewer"}</p>
            <h1 aria-live="polite">{prompt}</h1>
            <div className="row">
              {phase === "asking" ? (
                <button type="button" className="btn ghost small" onClick={skipSpeech}>
                  Start answering
                </button>
              ) : (
                <button type="button" className="btn ghost small" onClick={hearAgain} disabled={busy}>
                  {Icon.speaker}
                  Hear it again
                </button>
              )}
              <button type="button" className="btn ghost small" onClick={onSkip} disabled={busy}>
                Skip question
              </button>
            </div>
          </div>

          <div className="card answer">
            <div className="answer-head">
              <p className={`status ${phase === "listening" ? "live" : ""}`} role="status">
                <span className="dot" aria-hidden="true" />
                {status}
              </p>
              <p className="timer">{usedTyping.current ? "" : clock(seconds)}</p>
            </div>

            {typing ? (
              <div className="field">
                <label htmlFor="typed" className="visually-hidden">
                  Your answer
                </label>
                <textarea
                  id="typed"
                  rows={7}
                  placeholder="Type your answer as you would say it"
                  value={typed}
                  disabled={!answering}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="meter" role="img" aria-label="Your voice level">
                  {levels.map((level, i) => (
                    <div key={i} className={phase === "listening" ? "meter-bar on" : "meter-bar"} style={{ height: `${Math.round(level * 100)}%` }} />
                  ))}
                </div>
                <p className="transcript">
                  {spoken ? (
                    <>
                      {finalText} <span className="interim">{interim}</span>
                    </>
                  ) : (
                    <span className="muted">{phase === "asking" ? "Listen to the question, then answer out loud." : "Start speaking. Your words appear here."}</span>
                  )}
                </p>
              </>
            )}

            {notice ? (
              <p className="notice" role="alert">
                {notice}
              </p>
            ) : null}

            <div className="answer-actions">
              <div className="row">
                {typing ? null : (
                  <button
                    type="button"
                    className="round-btn"
                    aria-label={phase === "paused" ? "Resume microphone" : "Pause microphone"}
                    onClick={togglePause}
                    disabled={!answering}
                  >
                    {phase === "paused" ? Icon.play : Icon.pause}
                  </button>
                )}
                {!typing && answering ? (
                  <button type="button" className="link-btn" onClick={switchToTyping}>
                    Type instead
                  </button>
                ) : null}
              </div>
              {phase === "failed" ? (
                <button type="button" className="btn primary large" onClick={() => void evaluateNow()}>
                  {Icon.retry}
                  Try scoring again
                </button>
              ) : (
                <button type="button" className="btn primary large" onClick={() => void done()} disabled={!answering}>
                  {busy ? status + "..." : "I'm done answering"}
                  {busy ? null : Icon.arrow}
                </button>
              )}
            </div>
          </div>
        </section>

        <aside className="split-side" aria-label="Session details">
          <div className="card side-card">
            <h2>This answer</h2>
            <div className="signal-block">
              <div className="signal">
                <span className="muted">Length</span>
                <span className="strong">
                  {usedTyping.current ? `${words} words` : `${clock(seconds)} of ${clock(minMin * 60)} to ${clock(maxMin * 60)}`}
                </span>
              </div>
              {usedTyping.current ? null : (
                <div className="range" role="img" aria-label={`Target length ${clock(minMin * 60)} to ${clock(maxMin * 60)}`}>
                  <div className="range-target" style={{ left: `${((minMin * 60) / scale) * 100}%`, width: `${(((maxMin - minMin) * 60) / scale) * 100}%` }} />
                  <div className="range-marker" style={{ left: `${Math.min(1, seconds / scale) * 100}%` }} />
                </div>
              )}
            </div>
            <div className="signal">
              <span className="muted">Pace</span>
              <span className="strong">
                {liveWpm === null ? (
                  <span className="muted">{usedTyping.current ? "Not measured when typing" : "Measuring"}</span>
                ) : (
                  <>
                    {liveWpm} words a minute{" "}
                    <span className={liveWpm < 120 || liveWpm > 170 ? "warn" : "good"}>· {liveWpm < 120 ? "slow" : liveWpm > 170 ? "fast" : "good"}</span>
                  </>
                )}
              </span>
            </div>
            <div className="signal">
              <span className="muted">Filler words</span>
              <span className="strong">{fillers}</span>
            </div>
          </div>

          <div className="card side-card">
            <h2>Questions</h2>
            <ol className="question-list">
              {session.plan.map((q, i) => {
                const round = session.rounds[i];
                const isCurrent = i === session.index;
                return (
                  <li key={i} className={isCurrent ? "current" : i > session.index ? "upcoming" : ""}>
                    <span>
                      {i + 1}. {titleCase(q.competency)}
                    </span>
                    <span>
                      {isCurrent ? (
                        <span className="good">Answering now</span>
                      ) : round?.attempts.length ? (
                        <strong>{roundScore(round).toFixed(1)} / 5</strong>
                      ) : i < session.index ? (
                        "Skipped"
                      ) : i === session.index + 1 ? (
                        "Up next"
                      ) : (
                        ""
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>
      </main>
    </div>
  );
}
