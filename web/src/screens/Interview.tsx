import { useCallback, useEffect, useRef, useState } from "react";
import { evaluate, interviewerTurn, ROUND_SHAPE, type Context, type Exchange } from "../../../src/coach.js";
import { analyzeDelivery, countWords, LENGTH_TARGETS } from "../../../src/metrics.js";
import { analyzePacing } from "../../../src/pacing.js";
import type { LLM } from "../../../src/types.js";
import { Header, Icon } from "../components.js";
import { explainError } from "../lib/llm.js";
import { clock, roundScore, titleCase } from "../lib/score.js";
import { createRecognizer, recognitionSupported, speak, useMicLevels, type Recognizer } from "../lib/speech.js";
import type { Attempt, Session, Settings } from "../lib/types.js";

/**
 * One interview topic, held as a live conversation: the interviewer speaks,
 * the candidate replies (or asks something back), and the interviewer responds
 * to what was said until the topic is covered.
 */

type Phase = "asking" | "listening" | "paused" | "thinking" | "evaluating" | "failed";

const SPEAKING_WPM = 140;
const LENGTH_NOTE = /^(Short|Long):/;

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
  /** The earlier attempt, when this is a retry of the same topic. */
  previous?: Attempt;
  onComplete: (attempt: Attempt) => void;
  onSkip: () => void;
  onEnd: () => void;
}) {
  const topic = session.plan[session.index];
  const closing = topic.kind === "candidate-questions";
  const ctx: Context = { type: session.type, jobDescription: session.setup.jobDescription || undefined, resume: session.setup.resume || undefined };
  const maxTurns = settings.followUps ? ROUND_SHAPE[session.type].turns : 1;
  // The interviewer introduces the round once, before the first question.
  const intro = session.index === 0 && !previous && session.intro ? `${session.intro} ` : "";

  const [phase, setPhase] = useState<Phase>("asking");
  const [prompt, setPrompt] = useState(topic.question);
  const [thread, setThread] = useState<Exchange[]>([]);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [typing, setTyping] = useState(!recognitionSupported());
  const [seconds, setSeconds] = useState(0);
  const [turnStart, setTurnStart] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const alive = useRef(true);
  const exchanges = useRef<Exchange[]>([]);
  const recognizer = useRef<Recognizer | null>(null);
  const cancelSpeech = useRef<() => void>(() => {});
  const typingRef = useRef(typing);
  typingRef.current = typing;
  const usedTyping = useRef(typing);
  const secondsRef = useRef(0);
  secondsRef.current = seconds;
  const threadEnd = useRef<HTMLDivElement>(null);

  const listen = useCallback(() => {
    if (!alive.current) return;
    setPhase("listening");
    if (!typingRef.current) recognizer.current?.start();
  }, []);

  /** The interviewer says `text`; then it is the candidate's turn. */
  const begin = useCallback(
    (text: string, spoken = text) => {
      recognizer.current?.stop();
      cancelSpeech.current();
      setPrompt(text);
      setFinalText("");
      setInterim("");
      setTyped("");
      setTurnStart(secondsRef.current);
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
        cancelSpeech.current = speak(spoken, listen);
      } else {
        listen();
      }
    },
    [listen, settings.speakQuestions],
  );

  useEffect(() => {
    alive.current = true;
    exchanges.current = [];
    begin(topic.question, `${intro}${topic.question}`);
    return () => {
      alive.current = false;
      recognizer.current?.stop();
      cancelSpeech.current();
    };
    // One mount per topic attempt: the parent re-keys this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "listening") return;
    const started = Date.now();
    const base = secondsRef.current;
    const id = window.setInterval(() => setSeconds(base + (Date.now() - started) / 1000), 250);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (thread.length) threadEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [thread.length, prompt]);

  const levels = useMicLevels(phase === "listening" && !typing);
  const spoken = `${finalText} ${interim}`.trim();
  const current = typing ? typed.trim() : spoken;
  const allText = [...thread.map((e) => e.answer), current].join("\n").trim();
  const words = countWords(allText);
  const liveWpm = !usedTyping.current && seconds >= 8 ? Math.round(words / (seconds / 60)) : null;
  const fillers = analyzeDelivery(allText, session.type).fillerCount;
  const turnSeconds = Math.max(0, seconds - turnStart);

  // The length target applies to the opening answer; later turns are shorter by nature.
  const firstTurn = thread.length === 0 && !closing;
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
      const said = exchanges.current;
      const feedback = await evaluate(
        llm,
        ctx,
        said,
        undefined,
        previous ? { answer: previous.exchanges.map((e) => e.answer).join("\n"), feedback: previous.feedback } : undefined,
        topic,
      );
      if (!alive.current) return;
      const text = said.map((e) => e.answer).join("\n");
      // Typing speed says nothing about speaking pace, so estimate from length instead.
      const duration = usedTyping.current ? (countWords(text) / SPEAKING_WPM) * 60 : secondsRef.current;
      const pacing = analyzePacing({ text, duration, segments: [] }, session.type);
      // Length targets describe a single answer, not a whole conversation.
      const multi = said.length > 1 || closing;
      const notes = pacing.notes.filter((n) => !(multi && LENGTH_NOTE.test(n)) && !(usedTyping.current && /pace/i.test(n)));
      onComplete({
        exchanges: said,
        feedback,
        metrics: analyzeDelivery(text, session.type),
        pacing: { ...pacing, notes, wordsPerMinute: usedTyping.current ? 0 : pacing.wordsPerMinute },
      });
    } catch (err) {
      if (!alive.current) return;
      setNotice(explainError(err));
      setPhase("failed");
    }
  };

  /** Records the candidate's turn, then lets the interviewer respond or wrap up. */
  const send = async (wrapUp = false) => {
    if (!current && (exchanges.current.length === 0 || !wrapUp)) {
      setNotice(closing ? "Ask a question first, or skip this part." : "Say or type a reply first.");
      return;
    }
    recognizer.current?.stop();
    cancelSpeech.current();
    setNotice(null);
    if (current) {
      exchanges.current = [...exchanges.current, { question: prompt, answer: current }];
      setThread(exchanges.current);
      setFinalText("");
      setInterim("");
      setTyped("");
    }

    const turnsLeft = maxTurns - exchanges.current.length;
    if (!wrapUp && current && turnsLeft > 0) {
      setPhase("thinking");
      try {
        const next = await interviewerTurn(llm, ctx, topic, exchanges.current, turnsLeft);
        if (!alive.current) return;
        if (!next.done) {
          begin(next.reply);
          return;
        }
        if (next.reply) {
          // A closing remark: say it while the conversation is being scored.
          setPrompt(next.reply);
          if (settings.speakQuestions) cancelSpeech.current = speak(next.reply, () => {});
        }
      } catch {
        // If the interviewer cannot reply, score what was said instead of losing it.
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
          ? closing
            ? "Type your question"
            : "Type your reply"
          : "Listening"
        : phase === "paused"
          ? "Paused"
          : phase === "thinking"
            ? "Interviewer is thinking"
            : phase === "evaluating"
              ? "Scoring this conversation"
              : "Could not score that";
  const answering = phase === "listening" || phase === "paused";
  const busy = phase === "thinking" || phase === "evaluating";
  const turnNumber = thread.length + 1;
  const lastTurn = turnNumber >= maxTurns;

  return (
    <div className="page">
      <Header subtitle={`${session.role}, ${session.drill ? `${session.drill} drill` : `${titleCase(session.type).toLowerCase()} round`}`} onHome={onEnd}>
        <button type="button" className="btn ghost small" onClick={onEnd}>
          End interview
        </button>
      </Header>

      <main className="split">
        <section className="split-main" aria-label="Conversation">
          <div className="progress">
            <div className="progress-head">
              <p className="strong">
                Question {session.index + 1} of {session.plan.length}
                {previous ? <span className="muted"> · second attempt</span> : null}
              </p>
              <p className="muted small-text">{closing ? "Your questions for the interviewer" : `Testing: ${topic.competency.replace(/-/g, " ")}`}</p>
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

          {thread.length ? (
            <ol className="thread" aria-label="Conversation so far">
              {thread.map((e, i) => (
                <li key={i}>
                  <p className="said interviewer">
                    <span className="who">Interviewer</span>
                    {e.question}
                  </p>
                  <p className="said you">
                    <span className="who">You</span>
                    {e.answer}
                  </p>
                </li>
              ))}
            </ol>
          ) : null}

          <div className="question" ref={threadEnd}>
            <p className="eyebrow muted">Interviewer</p>
            {intro && thread.length === 0 ? <p className="intro">{intro.trim()}</p> : null}
            <h1 className={thread.length ? "reply" : ""} aria-live="polite">
              {prompt}
            </h1>
            <div className="row">
              {phase === "asking" ? (
                <button type="button" className="btn ghost small" onClick={skipSpeech}>
                  {closing ? "Start asking" : "Start answering"}
                </button>
              ) : (
                <button type="button" className="btn ghost small" onClick={hearAgain} disabled={busy}>
                  {Icon.speaker}
                  Hear it again
                </button>
              )}
              <button type="button" className="btn ghost small" onClick={onSkip} disabled={busy}>
                {closing ? "Skip this part" : "Skip question"}
              </button>
            </div>
          </div>

          <div className="card answer">
            <div className="answer-head">
              <p className={`status ${phase === "listening" ? "live" : ""}`} role="status">
                <span className="dot" aria-hidden="true" />
                {status}
              </p>
              <p className="timer">{usedTyping.current ? "" : clock(turnSeconds)}</p>
            </div>

            {typing ? (
              <div className="field">
                <label htmlFor="typed" className="visually-hidden">
                  {closing ? "Your question" : "Your reply"}
                </label>
                <textarea
                  id="typed"
                  rows={6}
                  placeholder={closing ? "Type a question for the interviewer" : "Type your reply as you would say it. You can ask a question back."}
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
                    <span className="muted">
                      {phase === "asking"
                        ? "Listen, then reply out loud."
                        : closing
                          ? "Ask your question out loud."
                          : "Start speaking. You can also ask the interviewer a question."}
                    </span>
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
                {answering && thread.length > 0 && !lastTurn ? (
                  <button type="button" className="link-btn" onClick={() => void send(true)}>
                    {closing ? "No more questions" : "Finish this question"}
                  </button>
                ) : null}
              </div>
              {phase === "failed" ? (
                <button type="button" className="btn primary large" onClick={() => void evaluateNow()}>
                  {Icon.retry}
                  Try scoring again
                </button>
              ) : (
                <button type="button" className="btn primary large" onClick={() => void send()} disabled={!answering}>
                  {busy ? `${status}...` : closing ? "Ask" : "Send reply"}
                  {busy ? null : Icon.arrow}
                </button>
              )}
            </div>
          </div>
        </section>

        <aside className="split-side" aria-label="Session details">
          <div className="card side-card">
            <h2>This conversation</h2>
            <div className="signal">
              <span className="muted">Turn</span>
              <span className="strong">
                {Math.min(turnNumber, maxTurns)} of up to {maxTurns}
              </span>
            </div>
            <div className="signal-block">
              <div className="signal">
                <span className="muted">{firstTurn ? "Opening answer" : "This reply"}</span>
                <span className="strong">
                  {usedTyping.current
                    ? `${countWords(current)} words`
                    : firstTurn
                      ? `${clock(turnSeconds)} of ${clock(minMin * 60)} to ${clock(maxMin * 60)}`
                      : clock(turnSeconds)}
                </span>
              </div>
              {usedTyping.current || !firstTurn ? null : (
                <div className="range" role="img" aria-label={`Target length ${clock(minMin * 60)} to ${clock(maxMin * 60)}`}>
                  <div className="range-target" style={{ left: `${((minMin * 60) / scale) * 100}%`, width: `${(((maxMin - minMin) * 60) / scale) * 100}%` }} />
                  <div className="range-marker" style={{ left: `${Math.min(1, turnSeconds / scale) * 100}%` }} />
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
                      {i + 1}. {q.kind === "candidate-questions" ? "Your questions" : titleCase(q.competency)}
                    </span>
                    <span>
                      {isCurrent ? (
                        <span className="good">In progress</span>
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
