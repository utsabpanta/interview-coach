import { useState } from "react";
import { Header, Icon, Logo } from "../components.js";
import { answered, bySkill, clock, delivery, enoughToJudge, readiness, retryGain, titleCase, weakestSkill } from "../lib/score.js";
import { downloadCanvas, drawShareCard, shareHeadline } from "../lib/shareCard.js";
import type { Session } from "../lib/types.js";

export function Scorecard({
  session,
  previous,
  onDrill,
  onNew,
}: {
  session: Session;
  /** Score of the last comparable session (same role, type, and kind), if there was one. */
  previous: number | null;
  onDrill: (competency: string) => void;
  onNew: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const rounds = answered(session);
  const planned = session.plan.length;
  // A number from one or two answers would look far more certain than it is.
  const judged = enoughToJudge(rounds.length, planned);
  const score = readiness(rounds);
  const gain = retryGain(rounds);
  const skills = bySkill(rounds);
  const weakest = weakestSkill(rounds);
  const sound = delivery(rounds);
  const delta = judged && previous !== null ? score - previous : null;

  const roundLabel = `${titleCase(session.type)} ${session.drill ? `drill (${session.drill.replace(/-/g, " ")})` : "round"}, ${session.role}`;
  const headline = shareHeadline(score, judged ? previous : null);
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

  return (
    <div className="page">
      <Header subtitle={roundLabel} onHome={onNew}>
        <button type="button" className="btn ghost small" onClick={onNew}>
          New interview
        </button>
      </Header>

      <main className="stack">
        <section className="split-row" aria-label="Practice score">
          <div className="card readiness">
            <p className="eyebrow muted">Practice score for this round</p>
            {judged ? (
              <>
                <div className="readiness-head">
                  <h1>
                    {score}
                    <span> / 100</span>
                  </h1>
                  {delta !== null && delta !== 0 ? (
                    <p className={`chip ${delta < 0 ? "warn" : ""}`}>
                      {delta > 0 ? Icon.up : Icon.down}
                      {delta > 0 ? "Up" : "Down"} {Math.abs(delta)} since your last {session.drill ? "drill on this skill" : "round for this role"}
                    </p>
                  ) : null}
                </div>
                <div className="readiness-bar" role="img" aria-label={`Practice score ${score} out of 100`}>
                  <div className="fill accent" style={{ width: `${score}%` }} />
                </div>
              </>
            ) : (
              <h1 className="not-enough">Not enough to score yet</h1>
            )}
            <p>
              You answered {rounds.length} of {planned} {planned === 1 ? "topic" : "topics"}.{" "}
              {judged
                ? "The score is the average of your first answers, as a share of the maximum: scoring 4 out of 5 on everything gives 80."
                : "Answer at least three topics, and at least half the round, to get a score."}
              {judged && gain !== null && gain !== 0 ? ` Your retries scored ${Math.abs(gain)} points ${gain > 0 ? "higher" : "lower"}; they are not counted, because they came after the feedback.` : ""}
            </p>
            <p className="muted small-text">
              Scores are one AI model's opinion of a few answers. Use them to see what to practice, not to predict a hiring decision.
            </p>
          </div>

          {judged ? (
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
              <p className="muted small-text">Shares your score, the role, and the interview type. Your answers and the job posting are never included.</p>
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
          ) : null}
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
                      {weak ? <span className="warn"> · lowest</span> : null}
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
                <dt>Speaking time per topic</dt>
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
