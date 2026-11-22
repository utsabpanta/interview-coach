import { useState } from "react";
import { Header, Icon, Logo } from "../components.js";
import { answered, bySkill, clock, delivery, READY_AT, readiness, titleCase, weakestSkill } from "../lib/score.js";
import { downloadCanvas, drawShareCard, shareHeadline } from "../lib/shareCard.js";
import type { Session } from "../lib/types.js";

export function Scorecard({
  session,
  previous,
  onDrill,
  onNew,
}: {
  session: Session;
  /** Readiness of the last session for the same role, if there was one. */
  previous: number | null;
  onDrill: (competency: string) => void;
  onNew: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const rounds = answered(session);
  const score = readiness(rounds);
  const skills = bySkill(rounds);
  const weakest = weakestSkill(rounds);
  const sound = delivery(rounds);
  const delta = previous === null ? null : score - previous;

  const roundLabel = `${titleCase(session.type)} round, ${session.role}`;
  const headline = shareHeadline(score, previous);
  const summary = `${headline}. ${roundLabel}. Practiced with Callback, open-source spoken interview practice: https://github.com/utsabpanta/interview-coach`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const verdict =
    score >= READY_AT
      ? `You are past the white line at ${READY_AT}, where answers hold up under follow-up questions. Keep them sharp with short drills.`
      : `The white line marks ${READY_AT}, where answers hold up under follow-up questions.${
          weakest && skills.length > 1 ? ` ${titleCase(weakest)} is what stands between you and it.` : ""
        }`;

  return (
    <div className="page">
      <Header subtitle={roundLabel} onHome={onNew}>
        <button type="button" className="btn ghost small" onClick={onNew}>
          New interview
        </button>
      </Header>

      <main className="stack">
        <section className="split-row" aria-label="Readiness">
          <div className="card readiness">
            <p className="eyebrow muted">Readiness for this role</p>
            <div className="readiness-head">
              <h1>
                {score}
                <span> / 100</span>
              </h1>
              {delta !== null && delta !== 0 ? (
                <p className={`chip ${delta < 0 ? "warn" : ""}`}>
                  {delta > 0 ? Icon.up : Icon.down}
                  {delta > 0 ? "Up" : "Down"} {Math.abs(delta)} since your last session
                </p>
              ) : null}
            </div>
            <div className="readiness-bar" role="img" aria-label={`Readiness ${score} out of 100; ${READY_AT} is interview-ready`}>
              <div className="fill accent" style={{ width: `${score}%` }} />
              <div className="ready-line" style={{ left: `${READY_AT}%` }} />
            </div>
            <p>
              You answered {rounds.length} {rounds.length === 1 ? "question" : "questions"}. {verdict}
            </p>
          </div>

          <div className="card share">
            <h2>Share your progress</h2>
            <div className="share-preview">
              <p className="share-brand">
                <Logo size={18} />
                Callback
              </p>
              <p className="share-headline">{headline}</p>
              <p className="muted small-text">{roundLabel}</p>
            </div>
            <p className="muted small-text">The card shows scores only. Your answers and the job posting are never included.</p>
            <div className="row grow">
              <button type="button" className="btn primary" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy summary"}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => downloadCanvas(drawShareCard({ headline, subline: roundLabel }), "callback-scorecard.png")}
              >
                Save image
              </button>
            </div>
          </div>
        </section>

        <section className="split-row" aria-label="Breakdown">
          <div className="card skills">
            <h2>By skill</h2>
            <div className="skill-rows">
              {skills.map((s) => {
                const weak = skills.length > 1 && s.competency === weakest;
                return (
                  <div className="skill-row" key={s.competency}>
                    <span>{titleCase(s.competency)}</span>
                    <div className="track tall" role="img" aria-label={`${s.competency}: ${s.score} out of 5`}>
                      <div className={`fill ${weak ? "warn-fill" : "accent"}`} style={{ width: `${(s.score / 5) * 100}%` }} />
                    </div>
                    <span className="skill-value">
                      {s.score.toFixed(1)}
                      {weak ? <span className="warn"> · weakest</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card sound">
            <h2>How you sounded</h2>
            <dl>
              <div>
                <dt>Pace</dt>
                <dd>{sound.wordsPerMinute ? `${sound.wordsPerMinute} words a minute` : "Not measured"}</dd>
              </div>
              <div>
                <dt>Average answer</dt>
                <dd>{clock(sound.averageSeconds)}</dd>
              </div>
              <div>
                <dt>Filler words</dt>
                <dd>{sound.fillersPer100} per 100 words</dd>
              </div>
              {sound.ownership ? (
                <div>
                  <dt>"I" versus "we"</dt>
                  <dd>{sound.ownership}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </section>

        {weakest ? (
          <section className="card drill" aria-label="Next drill">
            <div>
              <p className="eyebrow">Your next drill</p>
              <h2>Ten-minute drill: {weakest.replace(/-/g, " ")}</h2>
              <p>Three questions on your lowest-scoring skill, with a retry on each.</p>
            </div>
            <button type="button" className="btn primary large" onClick={() => onDrill(weakest)}>
              Start the drill
              {Icon.arrow}
            </button>
          </section>
        ) : null}
      </main>
    </div>
  );
}
