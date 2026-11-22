import { useCallback, useMemo, useState } from "react";
import { planInterview } from "../../src/coach.js";
import type { LLM } from "../../src/types.js";
import { SettingsDialog } from "./components.js";
import { explainError } from "./lib/llm.js";
import { makeLLM, missing } from "./lib/providers.js";
import { MockLLM } from "./lib/mockLlm.js";
import { answered, previousReadiness, summarize } from "./lib/score.js";
import { loadHistory, loadSettings, saveSettings, saveToHistory } from "./lib/store.js";
import type { Attempt, Round, Session, SessionSummary, Settings, Setup } from "./lib/types.js";
import { Feedback } from "./screens/Feedback.js";
import { Interview } from "./screens/Interview.js";
import { Scorecard } from "./screens/Scorecard.js";
import { Start } from "./screens/Start.js";

type Stage = "start" | "interview" | "feedback" | "scorecard";

const QUESTIONS = 5;
const DRILL_QUESTIONS = 3;

// Dev server only: `?mock=1` swaps in a scripted model so the flow can be clicked through without a key.
const MOCK = import.meta.env.DEV && new URLSearchParams(window.location.search).has("mock");

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [history, setHistory] = useState<SessionSummary[]>(loadHistory);
  const [stage, setStage] = useState<Stage>("start");
  const [session, setSession] = useState<Session | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [attemptKey, setAttemptKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ reason?: string; pending?: Setup } | null>(null);
  const [previous, setPrevious] = useState<number | null>(null);

  const llm = useMemo<LLM | null>(() => (MOCK ? new MockLLM() : makeLLM(settings)), [settings]);

  const begin = useCallback(
    async (model: LLM, setup: Setup, drill?: string) => {
      setBusy(true);
      setError(null);
      try {
        const plan = await planInterview(
          model,
          {
            type: setup.type,
            jobDescription: setup.jobDescription || undefined,
            resume: setup.resume || undefined,
            focusCompetency: drill,
          },
          drill ? DRILL_QUESTIONS : QUESTIONS,
        );
        if (plan.questions.length === 0) throw new Error("The model returned no questions. Try again.");
        setSession({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          startedAt: new Date().toISOString(),
          role: plan.role,
          type: setup.type,
          setup,
          drill,
          plan: plan.questions,
          index: 0,
          rounds: [],
        });
        setRetrying(false);
        setAttemptKey((k) => k + 1);
        setStage("interview");
        window.scrollTo(0, 0);
      } catch (err) {
        setError(explainError(err));
        setStage("start");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const start = (setup: Setup) => {
    if (!llm) {
      setDialog({ reason: missing(settings) ?? undefined, pending: setup });
      return;
    }
    void begin(llm, setup);
  };

  const saveDialog = (next: Settings) => {
    setSettings(next);
    saveSettings(next);
    const pending = dialog?.pending;
    setDialog(null);
    const model = makeLLM(next);
    if (pending && model) void begin(model, pending);
  };

  const finish = (current: Session) => {
    if (answered(current).length === 0) {
      setSession(null);
      setStage("start");
      return;
    }
    const summary = summarize(current);
    setPrevious(previousReadiness(history, summary));
    setHistory(saveToHistory(summary));
    setStage("scorecard");
    window.scrollTo(0, 0);
  };

  const goTo = (current: Session, index: number) => {
    if (index >= current.plan.length) {
      finish(current);
      return;
    }
    setSession({ ...current, index });
    setRetrying(false);
    setAttemptKey((k) => k + 1);
    setStage("interview");
    window.scrollTo(0, 0);
  };

  const complete = (attempt: Attempt) => {
    if (!session) return;
    const planned = session.plan[session.index];
    const rounds = [...session.rounds];
    const existing = rounds[session.index];
    const round: Round = existing
      ? { ...existing, attempts: [...existing.attempts, attempt] }
      : { question: planned.question, competency: planned.competency, attempts: [attempt] };
    rounds[session.index] = round;
    setSession({ ...session, rounds });
    setStage("feedback");
    window.scrollTo(0, 0);
  };

  const retry = () => {
    setRetrying(true);
    setAttemptKey((k) => k + 1);
    setStage("interview");
    window.scrollTo(0, 0);
  };

  const round = session?.rounds[session.index];

  return (
    <>
      {stage === "start" || !session || !llm ? (
        <Start busy={busy} error={error} history={history} onStart={start} onSettings={() => setDialog({})} />
      ) : stage === "interview" ? (
        <Interview
          key={attemptKey}
          session={session}
          settings={settings}
          llm={llm}
          previous={retrying && round ? round.attempts[round.attempts.length - 1] : undefined}
          onComplete={complete}
          onSkip={() => goTo(session, session.index + 1)}
          onEnd={() => finish(session)}
        />
      ) : stage === "feedback" && round ? (
        <Feedback session={session} round={round} onRetry={retry} onNext={() => goTo(session, session.index + 1)} onFinish={() => finish(session)} />
      ) : (
        <Scorecard
          session={session}
          previous={previous}
          onDrill={(competency) => void begin(llm, session.setup, competency)}
          onNew={() => {
            setSession(null);
            setStage("start");
            window.scrollTo(0, 0);
          }}
        />
      )}

      {busy && stage === "scorecard" ? (
        <div className="scrim" role="status">
          <p className="dialog">Preparing your drill...</p>
        </div>
      ) : null}

      {dialog ? <SettingsDialog settings={settings} reason={dialog.reason} onSave={saveDialog} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
