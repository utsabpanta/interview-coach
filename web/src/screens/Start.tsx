import { useState, type FormEvent } from "react";
import { INTERVIEW_TYPES, type InterviewType } from "../../../src/coach.js";
import { Header, Icon } from "../components.js";
import { titleCase } from "../lib/score.js";
import type { SessionSummary, Setup } from "../lib/types.js";

const TYPE_LABEL: Record<InterviewType, string> = {
  behavioral: "Behavioral",
  technical: "Technical",
  "system-design": "System design",
};

const STEPS = [
  ["01", "Talk, don't type", "The interviewer asks out loud and follows up on your weakest claim, the way a real panel does."],
  ["02", "One fix, then retry", "After each answer you get the single most important change, and a second attempt to prove it."],
  ["03", "Watch readiness climb", "A readiness score for the role shows where you stand and what to drill for ten minutes tomorrow."],
];

export function Start({
  busy,
  error,
  history,
  onStart,
  onSettings,
}: {
  busy: boolean;
  error: string | null;
  history: SessionSummary[];
  onStart: (setup: Setup) => void;
  onSettings: () => void;
}) {
  const [jobDescription, setJob] = useState("");
  const [resume, setResume] = useState("");
  const [showResume, setShowResume] = useState(false);
  const [type, setType] = useState<InterviewType>("behavioral");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onStart({ jobDescription: jobDescription.trim(), resume: resume.trim(), type });
  };

  const recent = [...history].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  return (
    <div className="page">
      <Header onHome={() => {}}>
        <a className="nav-link" href="#how">
          How it works
        </a>
        <a className="btn ghost small" href="https://github.com/utsabpanta/interview-coach" target="_blank" rel="noreferrer">
          Star on GitHub
        </a>
        <button type="button" className="icon-btn" aria-label="Settings" onClick={onSettings}>
          {Icon.gear}
        </button>
      </Header>

      <main className="start">
        <div className="hero">
          <p className="eyebrow">Open-source interview practice</p>
          <h1>Paste a job posting. Be in the interview in 60 seconds.</h1>
          <p className="lede">
            A spoken mock interview built for that exact role. You talk, it pushes back, and you get one thing to fix after every answer.
          </p>
        </div>

        <form className="card start-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="job">Job posting</label>
            <textarea
              id="job"
              rows={5}
              placeholder="Paste the full job description"
              value={jobDescription}
              onChange={(e) => setJob(e.target.value)}
            />
            <p className="hint">Leave it empty for general practice.</p>
          </div>

          {showResume ? (
            <div className="field">
              <label htmlFor="resume">Your resume</label>
              <textarea
                id="resume"
                rows={5}
                placeholder="Paste your resume as text"
                value={resume}
                onChange={(e) => setResume(e.target.value)}
              />
            </div>
          ) : (
            <button type="button" className="add-btn" onClick={() => setShowResume(true)}>
              Add your resume <span className="muted small-text">optional</span>
            </button>
          )}

          <fieldset className="types">
            <legend>Interview type</legend>
            <div className="pills">
              {INTERVIEW_TYPES.map((t) => (
                <button key={t} type="button" className="pill" aria-pressed={type === t} onClick={() => setType(t)}>
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </fieldset>

          {error ? (
            <p className="notice" role="alert">
              {error}
            </p>
          ) : null}

          <div className="start-footer">
            <p className="muted">5 questions, about 10 minutes, out loud</p>
            <button type="submit" className="btn primary large" disabled={busy}>
              {Icon.mic}
              {busy ? "Preparing your interview..." : "Start interview"}
            </button>
          </div>
        </form>

        <ul className="trust">
          <li>{Icon.check}No signup</li>
          <li>{Icon.check}Free and local model options</li>
          <li>{Icon.check}No server: your history stays in this browser</li>
        </ul>

        {recent.length ? (
          <section className="card history" aria-label="Your sessions">
            <h2>Your sessions</h2>
            <ul>
              {recent.map((h) => (
                <li key={h.id}>
                  <span>
                    {h.role} <span className="muted">· {titleCase(h.type)}</span>
                  </span>
                  <span className="muted">{new Date(h.date).toLocaleDateString()}</span>
                  <strong>{h.readiness} / 100</strong>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section id="how" className="steps" aria-label="How it works">
          {STEPS.map(([n, title, body]) => (
            <div className="card step" key={n}>
              <p className="step-n">{n}</p>
              <h2>{title}</h2>
              <p>{body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
