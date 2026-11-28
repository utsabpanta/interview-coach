import { useCallback, useEffect, useRef, useState } from "react";
import { evaluate, interviewerTurn, ROUND_SHAPE, type Context, type Exchange } from "../../../src/coach.js";
import { detectIntent, PATIENCE_MS, pauseBeforeReply, stripSignOff } from "../../../src/intents.js";
import { analyzeDelivery, countWords, LENGTH_TARGETS } from "../../../src/metrics.js";
import { analyzePacing } from "../../../src/pacing.js";
import type { LLM } from "../../../src/types.js";
import { Header, Icon } from "../components.js";
import { explainError } from "../lib/llm.js";
import { clock, roundScore, titleCase } from "../lib/score.js";
import { createRecognizer, recognitionSupported, useMicLevels, type Recognizer } from "../lib/speech.js";
import { speak } from "../lib/voice.js";
import type { Attempt, Session, Settings } from "../lib/types.js";

/**
 * One interview topic, held as a live conversation: the interviewer speaks,
 * the candidate replies (or asks something back), and the interviewer responds
 * to what was said until the topic is covered.
 *
 * The rule for turn-taking: never lose or cut short what the candidate says.
 * Silence is judged generously, every automatic reply can be taken back, and
 * nothing the candidate said is discarded without a way to restore it.
 */

type Phase = "asking" | "listening" | "paused" | "thinking" | "evaluating" | "failed" | "stalled";

const SPEAKING_WPM = 140;
const LENGTH_NOTE = /^(Short|Long):/;
// Requests to rephrase or clarify do not use up a turn, within reason.
const MAX_ASIDES = 3;
// Show the "about to reply" countdown for this long before the interviewer takes its turn.
const COUNTDOWN_MS = 3000;
// Sound without recognized words extends the wait only this long; past that it is treated as background noise.
const NOISE_LIMIT_MS = 12000;

interface BeginOptions {
  /** What is read aloud, when it differs from what is shown. */
  spoken?: string;
  /** Words the candidate already said this turn, to carry on from. */
  initial?: string;
  /** Start listening straight away, without reading anything aloud. */
  silent?: boolean;
}

export function Interview({
  session,
  settings,
  llm,
  previous,
  onComplete,
  onSkip,
  onEnd,
  onSettingsChange,
  onOpenSettings,
  preferTyping,
  onPreferTyping,
}: {
  session: Session;
  settings: Settings;
  llm: LLM;
  /** The earlier attempt, when this is a retry of the same topic. */
  previous?: Attempt;
  onComplete: (attempt: Attempt) => void;
  onSkip: () => void;
  onEnd: () => void;
  onSettingsChange: (next: Settings) => void;
  onOpenSettings: () => void;
  /** The candidate chose to type earlier in this interview. */
  preferTyping: boolean;
  onPreferTyping: () => void;
}) {
  const topic = session.plan[session.index];
  const closing = topic.kind === "candidate-questions";
  /** Technical and design rounds get a notes pad the interviewer can see. */
  const hasPad = session.type !== "behavioral" && !closing;
  const [workspace, setWorkspace] = useState("");
  const ctx: Context = {
    type: session.type,
    jobDescription: session.setup.jobDescription || undefined,
    resume: session.setup.resume || undefined,
    workspace: hasPad ? workspace : undefined,
  };
  const maxTurns = settings.followUps ? ROUND_SHAPE[session.type].turns : 1;
  // The interviewer introduces the round once, before the first question.
  const intro = session.index === 0 && !previous && session.intro ? `${session.intro} ` : "";

  const [phase, setPhase] = useState<Phase>("asking");
  const [prompt, setPrompt] = useState(topic.question);
  const [thread, setThread] = useState<Exchange[]>([]);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const voiceSupported = recognitionSupported();
  const [typing, setTyping] = useState(!voiceSupported || preferTyping);
  const [seconds, setSeconds] = useState(0);
  const [spokenSeconds, setSpokenSeconds] = useState(0);
  const [turnStart, setTurnStart] = useState(0);
  const [notice, setNotice] = useState<string | null>(
    voiceSupported ? null : "This browser cannot transcribe speech, so answers are typed. Chrome, Edge, and Safari support voice.",
  );
  /** Seconds until the interviewer replies on its own, while the candidate is silent. */
  const [countdown, setCountdown] = useState<number | null>(null);
  /** The candidate asked for more time on this turn, so do not reply automatically. */
  const [holding, setHolding] = useState(false);
  /** The last reply can still be taken back and continued. */
  const [canResume, setCanResume] = useState(false);
  /** Words that were taken as "repeat the question" and so not used as an answer. */
  const [discarded, setDiscarded] = useState<string | null>(null);

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

  // What has been heard this turn, and when.
  const heardText = useRef("");
  const lastSegment = useRef("");
  const lastWords = useRef(0);
  const lastVoice = useRef(0);
  const firstWords = useRef(0);
  /** Time actually spent speaking across the conversation, for an honest pace. */
  const speakingMs = useRef(0);
  const asides = useRef(0);
  /** Identifies the turn being listened to, so late results from an earlier turn are ignored. */
  const turnToken = useRef<object | null>(null);
  /** Identifies the model request in flight, so a reply that was taken back is ignored. */
  const request = useRef(0);
  const sending = useRef(false);
  /** This turn carries on an answer that was cut short, so wait longer before replying. */
  const patient = useRef(false);
  const resumable = useRef(false);
  const sendRef = useRef<(wrapUp?: boolean) => Promise<void>>(async () => {});

  const voiceRef = useRef(settings);
  voiceRef.current = settings;
  /** Speaks in the chosen voice; if the natural voice fails, says so once and carries on. */
  const say = useCallback((text: string, onEnd: () => void) => {
    const s = voiceRef.current;
    return speak(text, onEnd, {
      voice: s.voice,
      groqKey: s.keys.groq,
      onFallback: (reason) => {
        if (alive.current) setNotice(`The natural voice is unavailable, so the browser voice is being used. ${reason}`);
      },
    });
  }, []);

  const listen = useCallback(() => {
    if (!alive.current) return;
    // Silence is counted from the moment listening starts, never from before a pause.
    lastWords.current = Date.now();
    lastVoice.current = Date.now();
    setPhase("listening");
    if (!typingRef.current) recognizer.current?.start();
  }, []);

  /** The interviewer says `text`; then it is the candidate's turn. */
  const begin = useCallback(
    (text: string, opts: BeginOptions = {}) => {
      const initial = opts.initial?.trim() ?? "";
      recognizer.current?.stop();
      cancelSpeech.current();
      sending.current = false;
      setPrompt(text);
      setFinalText(initial);
      setInterim("");
      setTyped(typingRef.current ? initial : "");
      setTurnStart(secondsRef.current);
      setCountdown(null);
      setHolding(false);
      heardText.current = initial;
      lastSegment.current = "";
      firstWords.current = 0;
      patient.current = Boolean(initial);
      const token = {};
      turnToken.current = token;
      recognizer.current = createRecognizer(
        (f, i, segment) => {
          // Speech recognition can deliver words after it was stopped; those belong to a turn that is over.
          if (!alive.current || turnToken.current !== token) return;
          const heard = `${f} ${i}`.trim();
          // Any new words mean the candidate is still talking.
          if (heard !== heardText.current) {
            heardText.current = heard;
            lastSegment.current = segment;
            lastWords.current = Date.now();
            if (!firstWords.current) firstWords.current = Date.now();
            if (resumable.current) {
              resumable.current = false;
              setCanResume(false);
            }
            setDiscarded(null);
          }
          setFinalText(f);
          setInterim(i);
        },
        (reason) => {
          if (!alive.current || turnToken.current !== token) return;
          // Keep everything said so far when falling back to typing.
          setTyped(heardText.current);
          setNotice(reason);
          setTyping(true);
          usedTyping.current = true;
        },
        initial,
      );
      if (settings.speakQuestions && !opts.silent) {
        setPhase("asking");
        cancelSpeech.current = say(opts.spoken ?? text, listen);
      } else {
        listen();
      }
    },
    [listen, say, settings.speakQuestions],
  );

  useEffect(() => {
    alive.current = true;
    exchanges.current = [];
    begin(topic.question, { spoken: `${intro}${topic.question}` });
    return () => {
      alive.current = false;
      request.current += 1;
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
    const id = window.setInterval(() => {
      setSeconds(base + (Date.now() - started) / 1000);
      const thisTurn = firstWords.current ? Math.max(0, lastWords.current - firstWords.current) : 0;
      setSpokenSeconds((speakingMs.current + thisTurn) / 1000);
    }, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (thread.length) threadEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [thread.length, prompt]);

  const patienceMs = PATIENCE_MS[settings.patience] ?? PATIENCE_MS.normal;

  // Hands-free turn-taking: when the candidate has said something and then
  // goes quiet, the interviewer takes its turn without a button press.
  useEffect(() => {
    if (phase !== "listening" || typing || holding || !settings.handsFree) {
      setCountdown(null);
      return;
    }
    const id = window.setInterval(() => {
      const heard = heardText.current;
      if (!heard || sending.current) {
        setCountdown(null);
        return;
      }
      // The microphone hearing a voice counts as "still talking" even before the
      // words arrive, but sound with no words for a long time is just noise.
      const active = Math.max(lastWords.current, Math.min(lastVoice.current, lastWords.current + NOISE_LIMIT_MS));
      const wait = pauseBeforeReply(heard, patient.current ? Math.max(patienceMs, PATIENCE_MS.long) : patienceMs, lastSegment.current);
      const remaining = wait - (Date.now() - active);
      if (remaining <= 0) {
        setCountdown(null);
        void sendRef.current();
      } else {
        setCountdown(remaining <= COUNTDOWN_MS ? Math.ceil(remaining / 1000) : null);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [phase, typing, holding, settings.handsFree, patienceMs]);

  const levels = useMicLevels(phase === "listening" && !typing, 28, () => {
    lastVoice.current = Date.now();
  });
  const spoken = `${finalText} ${interim}`.trim();
  const current = typing ? typed.trim() : spoken;
  const allText = [...thread.filter((e) => !e.aside).map((e) => e.answer), current].join("\n").trim();
  const words = countWords(allText);
  const liveWpm = !usedTyping.current && spokenSeconds >= 6 ? Math.round(words / (spokenSeconds / 60)) : null;
  const fillers = analyzeDelivery(allText, session.type).fillerCount;
  const turnSeconds = Math.max(0, seconds - turnStart);

  // The length target applies to the opening answer; later turns are shorter by nature.
  const firstTurn = thread.length === 0 && !closing;
  const [minMin, maxMin] = LENGTH_TARGETS[session.type] ?? LENGTH_TARGETS.behavioral;
  const scale = maxMin * 60 * 1.25;

  const answered = () => exchanges.current.filter((e) => !e.aside).length;

  const switchToTyping = () => {
    recognizer.current?.stop();
    setTyped(spoken);
    setTyping(true);
    usedTyping.current = true;
    onPreferTyping();
  };

  /** Skipping or ending throws away what was said on this topic, so ask first. */
  const confirmDiscard = (action: string) =>
    exchanges.current.length === 0 && !current ? true : window.confirm(`${action} What you have said on this question will not be scored.`);
  const skip = () => {
    if (confirmDiscard("Skip this question?")) onSkip();
  };
  const end = () => {
    if (confirmDiscard("End the interview now?")) onEnd();
  };

  const evaluateNow = async () => {
    const mine = ++request.current;
    sending.current = true;
    setPhase("evaluating");
    setNotice(null);
    try {
      const said = exchanges.current;
      const answers = said.filter((e) => !e.aside);
      const feedback = await evaluate(
        llm,
        ctx,
        said,
        undefined,
        previous ? { answer: previous.exchanges.map((e) => e.answer).join("\n"), feedback: previous.feedback } : undefined,
        topic,
      );
      if (!alive.current || mine !== request.current) return;
      const text = answers.map((e) => e.answer).join("\n");
      // Pace comes from time spent speaking, not time spent thinking or waiting.
      // Typing speed says nothing about speaking pace, so estimate from length instead.
      const duration = usedTyping.current || !speakingMs.current ? (countWords(text) / SPEAKING_WPM) * 60 : speakingMs.current / 1000;
      const measured = !usedTyping.current && speakingMs.current > 0;
      const pacing = analyzePacing({ text, duration, segments: [] }, session.type);
      // Length targets describe a single answer, not a whole conversation.
      const multi = answers.length > 1 || closing;
      const notes = pacing.notes.filter((n) => !(multi && LENGTH_NOTE.test(n)) && !(!measured && /pace/i.test(n)));
      onComplete({
        exchanges: said,
        feedback,
        metrics: analyzeDelivery(text, session.type),
        pacing: { ...pacing, notes, wordsPerMinute: measured ? pacing.wordsPerMinute : 0 },
        ...(hasPad && workspace.trim() ? { workspace: workspace.trim() } : {}),
      });
    } catch (err) {
      if (!alive.current || mine !== request.current) return;
      sending.current = false;
      setNotice(explainError(err));
      setPhase("failed");
    }
  };

  /** The interviewer's side of the turn: reply to what was just said, or wrap the topic up. */
  const respond = async () => {
    const mine = ++request.current;
    sending.current = true;
    setPhase("thinking");
    setNotice(null);
    try {
      const turnsLeft = maxTurns - answered();
      const next = await interviewerTurn(llm, ctx, topic, exchanges.current, turnsLeft);
      // The candidate may have taken their reply back while the interviewer was thinking.
      if (!alive.current || mine !== request.current) return;
      if (next.aside && asides.current < MAX_ASIDES) {
        // The candidate asked to rephrase or clarify: answer them and keep their turn.
        asides.current += 1;
        exchanges.current = exchanges.current.map((e, i, all) => (i === all.length - 1 ? { ...e, aside: true } : e));
        setThread(exchanges.current);
        begin(next.reply);
        return;
      }
      // Out of turns means the topic ends, whatever the model says.
      if (!next.done && turnsLeft > 0 && next.reply) {
        begin(next.reply);
        return;
      }
      if (next.reply) {
        // A closing remark: say it while the conversation is being scored.
        setPrompt(next.reply);
        if (settings.speakQuestions) cancelSpeech.current = say(next.reply, () => {});
      }
    } catch (err) {
      if (!alive.current || mine !== request.current) return;
      // Say so, and let the candidate choose: nothing is scored behind their back.
      sending.current = false;
      setNotice(`The interviewer could not reply. ${explainError(err)}`);
      setPhase("stalled");
      return;
    }
    await evaluateNow();
  };

  /** Records the candidate's turn, then lets the interviewer respond or wrap up. */
  const send = async (wrapUp = false) => {
    if (sending.current) return;
    if (!current && (exchanges.current.length === 0 || !wrapUp)) {
      setNotice(closing ? "Ask a question first, or skip this part." : "Say or type a reply first.");
      return;
    }
    const segment = typing ? undefined : lastSegment.current || undefined;
    // "Can you repeat the question?" is answered on the spot: it is not an
    // answer, so it is not recorded, scored, or counted as a turn.
    const intent = wrapUp ? null : detectIntent(current, segment);
    if (intent === "repeat") {
      const said = current;
      begin(prompt);
      // The words are kept, in case they were meant as an answer after all.
      setDiscarded(said);
      setNotice(null);
      return;
    }
    const answer = intent === "done" ? stripSignOff(current, segment) || current : current;

    sending.current = true;
    recognizer.current?.stop();
    turnToken.current = null;
    cancelSpeech.current();
    setNotice(null);
    setCountdown(null);
    setDiscarded(null);
    if (firstWords.current) {
      speakingMs.current += Math.max(0, lastWords.current - firstWords.current) + 500;
      firstWords.current = 0;
    }
    if (answer) {
      exchanges.current = [...exchanges.current, { question: prompt, answer }];
      setThread(exchanges.current);
      setFinalText("");
      setInterim("");
      setTyped("");
      heardText.current = "";
      resumable.current = true;
      setCanResume(true);
    }

    if (!wrapUp && answer && maxTurns > 1) {
      await respond();
      return;
    }
    if (answered() === 0) {
      // Only clarifications so far: there is nothing to score yet.
      begin(prompt, { silent: true });
      setNotice(closing ? "Ask a question first, or skip this part." : "Answer the question first, or skip it.");
      return;
    }
    await evaluateNow();
  };
  sendRef.current = send;

  /** "I wasn't finished": take the last reply back and carry on from where it stopped. */
  const resumeLast = () => {
    const last = exchanges.current[exchanges.current.length - 1];
    if (!last) return;
    request.current += 1;
    if (last.aside) asides.current = Math.max(0, asides.current - 1);
    exchanges.current = exchanges.current.slice(0, -1);
    setThread(exchanges.current);
    resumable.current = false;
    setCanResume(false);
    begin(last.question, { initial: last.answer, silent: true });
    setNotice("Carry on. What you said so far is kept, and the interviewer will wait longer this time.");
  };

  /** The words taken as "repeat the question" were an answer after all. */
  const restoreDiscarded = () => {
    if (!discarded) return;
    const said = discarded;
    setDiscarded(null);
    begin(prompt, { initial: said, silent: true });
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
    cancelSpeech.current = say(prompt, listen);
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
              : phase === "stalled"
                ? "Interviewer could not reply"
                : "Could not score that";
  const answering = phase === "listening" || phase === "paused";
  const busy = phase === "thinking" || phase === "evaluating";
  const turnNumber = thread.filter((e) => !e.aside).length + 1;
  // Offered from the moment a reply is sent until the candidate starts their next one.
  const showResume = canResume && thread.length > 0 && (busy || phase === "asking" || (answering && !current));

  return (
    <div className="page">
      <Header subtitle={`${session.role}, ${session.drill ? `${session.drill} drill` : `${titleCase(session.type).toLowerCase()} round`}`} onHome={end}>
        <button type="button" className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
          {Icon.gear}
        </button>
        <button type="button" className="btn ghost small" onClick={end}>
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

          {showResume ? (
            <p className="auto-reply">
              <span>Cut off before you finished?</span>
              <button type="button" className="btn ghost small" onClick={resumeLast}>
                I wasn't finished
              </button>
            </p>
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
                <button type="button" className="btn ghost small" onClick={hearAgain} disabled={busy || phase === "stalled"}>
                  {Icon.speaker}
                  Hear it again
                </button>
              )}
              <button type="button" className="btn ghost small" onClick={skip} disabled={busy}>
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
                          : 'Start speaking. You can ask a question back, or say "can you repeat the question?"'}
                    </span>
                  )}
                </p>
              </>
            )}

            {hasPad ? (
              <details className="pad" open={workspace.length > 0 || undefined}>
                <summary>Notes pad: sketch an outline, pseudo-code, or a design in text</summary>
                <label htmlFor="pad" className="visually-hidden">
                  Notes pad, shared with the interviewer
                </label>
                <textarea
                  id="pad"
                  rows={7}
                  spellCheck={false}
                  placeholder={"client -> API gateway -> rate limiter -> service\n\nrequirements:\n- ..."}
                  value={workspace}
                  onChange={(e) => {
                    setWorkspace(e.target.value);
                    // Writing counts as still working, so the interviewer does not cut in.
                    lastWords.current = Date.now();
                  }}
                />
                <p className="hint">The interviewer sees this with each of your replies, and it counts toward your score.</p>
              </details>
            ) : null}

            {discarded ? (
              <p className="auto-reply">
                <span>Repeating the question. Not what you meant?</span>
                <button type="button" className="link-btn" onClick={restoreDiscarded}>
                  That was my answer
                </button>
              </p>
            ) : countdown !== null ? (
              <p className="auto-reply">
                <span aria-hidden="true">The interviewer replies in {countdown}s. Keep talking to continue.</span>
                <span className="visually-hidden" role="status">
                  The interviewer is about to reply. Keep talking to continue.
                </span>
                <button type="button" className="link-btn" onClick={() => setHolding(true)}>
                  I'm still thinking
                </button>
              </p>
            ) : holding && phase === "listening" && !typing ? (
              <p className="auto-reply" role="status">
                <span>Take your time. Press Send reply when you are done.</span>
              </p>
            ) : null}

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
                {!typing ? (
                  <button
                    type="button"
                    className="link-btn"
                    aria-pressed={settings.handsFree}
                    onClick={() => onSettingsChange({ ...settings, handsFree: !settings.handsFree })}
                  >
                    Hands-free: {settings.handsFree ? "on" : "off"}
                  </button>
                ) : null}
                {answering && thread.length > 0 ? (
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
              ) : phase === "stalled" ? (
                <div className="row">
                  <button type="button" className="btn ghost large" onClick={() => void evaluateNow()}>
                    Score what I have
                  </button>
                  <button type="button" className="btn primary large" onClick={() => void respond()}>
                    {Icon.retry}
                    Try again
                  </button>
                </div>
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
