import { averageScore, DIMENSIONS, type Feedback as FeedbackData } from "../../../src/coach.js";
import { Header, Icon, ScoreBars } from "../components.js";
import { annotate, clock, fillerBreakdown, saidByCandidate, titleCase } from "../lib/score.js";
import type { Attempt, Round, Session } from "../lib/types.js";

function bars(f: FeedbackData): Array<[string, number]> {
  return DIMENSIONS.map((d) => [titleCase(d), f.scores[d]]);
}

function AttemptCard({ title, attempt, tone }: { title: string; attempt: Attempt; tone: "accent" | "neutral" }) {
  return (
    <div className="card attempt">
      <div className="attempt-head">
        <h2 className={tone === "neutral" ? "muted" : ""}>{title}</h2>
        <p className={`big-score ${tone}`}>
          {averageScore(attempt.feedback).toFixed(1)}
          <span> / 5</span>
        </p>
      </div>
      <ScoreBars scores={bars(attempt.feedback)} tone={tone} />
      <p className="muted small-text">
        {attempt.metrics.words} words, about {clock(attempt.pacing.durationSeconds)} spoken, {attempt.metrics.fillerCount} filler{" "}
        {attempt.metrics.fillerCount === 1 ? "word" : "words"}
        {attempt.metrics.fillerCount ? ` (${fillerBreakdown(attempt.metrics.fillers)})` : ""}
      </p>
    </div>
  );
}

export function Feedback({
  session,
  round,
  onRetry,
  onNext,
  onFinish,
}: {
  session: Session;
  round: Round;
  onRetry: () => void;
  onNext: () => void;
  onFinish: () => void;
}) {
  const latest = round.attempts[round.attempts.length - 1];
  const before = round.attempts.length > 1 ? round.attempts[round.attempts.length - 2] : null;
  const isLast = session.index >= session.plan.length - 1;
  const closing = session.plan[session.index]?.kind === "candidate-questions";
  const fix = latest.feedback.fix ?? { headline: latest.feedback.improvements[0] ?? "Tighten the answer.", detail: "" };
  const delta = before ? Math.round((averageScore(latest.feedback) - averageScore(before.feedback)) * 10) / 10 : 0;
  const changes = latest.feedback.changes ?? [];
  // Coaching points are attached to the exact words they quote; a point whose
  // quote the candidate did not say is not shown.
  const annotated = latest.exchanges.map((exchange) => ({ exchange, ...annotate(exchange.answer, latest.feedback.notes ?? []) }));
  const shownNotes = annotated.some((a) => a.shown.length > 0);

  return (
    <div className="page">
      <Header subtitle={`${session.role}, ${titleCase(session.type).toLowerCase()} round`} onHome={onFinish}>
        <button type="button" className="btn ghost small" onClick={onFinish}>
          Finish and see scorecard
        </button>
      </Header>

      <main className="stack">
        <div className="question-recap">
          <p className="strong">
            Question {session.index + 1} of {session.plan.length}{" "}
            <span className="muted">· {closing ? "your questions" : round.competency.replace(/-/g, " ")}</span>
          </p>
          <p className="muted">{round.question}</p>
        </div>

        <section className="card fix" aria-label="The one thing to fix">
          <div className="fix-text">
            <p className="eyebrow">{before ? "The next thing to fix" : "The one thing to fix"}</p>
            <h1>{fix.headline}</h1>
            {fix.detail ? <p>{fix.detail}</p> : null}
          </div>
          {saidByCandidate(fix.quote, latest.exchanges) ? (
            <figure className="quote">
              <figcaption className="muted small-text">From what you said</figcaption>
              <blockquote>
                "<mark>{fix.quote}</mark>"
              </blockquote>
            </figure>
          ) : null}
        </section>

        <section className="compare" aria-label={before ? "Before and after" : "Your score"}>
          {before ? <AttemptCard title="Previous attempt" attempt={before} tone="neutral" /> : null}
          <AttemptCard title={before ? "This attempt" : closing ? "Your questions" : "Your answers"} attempt={latest} tone="accent" />

          {before ? (
            <div className="card change">
              <p className={`delta ${delta < 0 ? "warn" : ""}`}>
                {delta > 0 ? Icon.up : delta < 0 ? Icon.down : null}
                {delta === 0 ? "Same score" : `${Math.abs(delta).toFixed(1)} ${delta > 0 ? "better" : "lower"}`}
              </p>
              {changes.length ? (
                <>
                  <h2>What changed</h2>
                  <ul>
                    {changes.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : (
            <div className="card worked">
              <h2>What worked</h2>
              <ul>
                {latest.feedback.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              {[...latest.pacing.notes, ...latest.metrics.notes.filter((n) => !/^(Short|Long):/.test(n))].length ? (
                <>
                  <h2>Delivery</h2>
                  <ul>
                    {[...latest.pacing.notes, ...latest.metrics.notes.filter((n) => !/^(Short|Long):/.test(n))].map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          )}
        </section>

        <section className="card review" aria-label="The conversation, with coaching points">
          <h2>The conversation{shownNotes ? ", with coaching points" : ""}</h2>
          <ol className="thread in-card">
            {annotated.map(({ exchange, segments, shown }, i) => (
              <li key={i}>
                <p className="said interviewer">
                  <span className="who">Interviewer</span>
                  {exchange.question}
                </p>
                <p className="said you">
                  <span className="who">You</span>
                  {segments.map((seg, j) =>
                    seg.point ? (
                      <mark key={j} className="point">
                        {seg.text}
                        <sup>{seg.point}</sup>
                      </mark>
                    ) : (
                      <span key={j}>{seg.text}</span>
                    ),
                  )}
                </p>
                {shown.length ? (
                  <ul className="points">
                    {shown.map((n) => (
                      <li key={n.point}>
                        <span className="point-n">{n.point}</span>
                        {n.note}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
          {latest.workspace ? (
            <>
              <h2>Your notes pad</h2>
              <pre className="pad-view">{latest.workspace}</pre>
            </>
          ) : null}
        </section>

        <details className="card rewrite">
          <summary>{closing ? "See sharper questions you could ask" : "See a stronger version of your answer"}</summary>
          <p>{latest.feedback.rewrite}</p>
          <p className="muted small-text">
            Written by the model from your answer. Check it against what really happened before you use it; bracketed gaps are details for you to
            fill in.
          </p>
        </details>

        <div className="actions">
          <button type="button" className="btn ghost large" onClick={onRetry}>
            {Icon.retry}
            {before ? "Try once more" : "Try again"}
          </button>
          <button type="button" className="btn primary large" onClick={isLast ? onFinish : onNext}>
            {isLast ? "See your scorecard" : "Next question"}
            {Icon.arrow}
          </button>
        </div>
      </main>
    </div>
  );
}
