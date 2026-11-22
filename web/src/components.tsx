import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Settings } from "./lib/types.js";

const stroke = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 28 28" {...stroke} stroke="#B8F35A" strokeWidth={2.4}>
      <path d="M5 11v6M10 7v14M15 4v20M20 9v10M25 12v4" />
    </svg>
  );
}

export const Icon = {
  mic: (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" {...stroke} strokeWidth={2.2}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  ),
  arrow: (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" {...stroke} strokeWidth={2.4}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  up: (
    <svg aria-hidden="true" width="1em" height="1em" viewBox="0 0 24 24" {...stroke} strokeWidth={2.8}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  down: (
    <svg aria-hidden="true" width="1em" height="1em" viewBox="0 0 24 24" {...stroke} strokeWidth={2.8}>
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  ),
  check: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" {...stroke} stroke="#B8F35A" strokeWidth={2.6}>
      <path d="M4 12l5 5L20 6" />
    </svg>
  ),
  retry: (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" {...stroke} strokeWidth={2.2}>
      <path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5" />
    </svg>
  ),
  speaker: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" {...stroke} strokeWidth={2}>
      <path d="M4 9v6h4l5 4V5L8 9zM17 9a4 4 0 0 1 0 6" />
    </svg>
  ),
  pause: (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" {...stroke} strokeWidth={2.4}>
      <path d="M9 5v14M15 5v14" />
    </svg>
  ),
  play: (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" {...stroke} strokeWidth={2.2}>
      <path d="M8 5l11 7-11 7z" />
    </svg>
  ),
  gear: (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" {...stroke} strokeWidth={2}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
    </svg>
  ),
};

export function Header({ subtitle, onHome, children }: { subtitle?: string; onHome: () => void; children?: ReactNode }) {
  return (
    <header className="header">
      <div className="header-left">
        <button type="button" className="brand" onClick={onHome}>
          <Logo />
          Callback
        </button>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      <div className="header-actions">{children}</div>
    </header>
  );
}

/** A labelled 1-5 score bar. */
export function ScoreBars({ scores, tone }: { scores: Array<[label: string, value: number]>; tone: "accent" | "neutral" }) {
  return (
    <div className="bars">
      {scores.map(([label, value]) => (
        <div className="bar-row" key={label}>
          <span className="muted">{label}</span>
          <div className="track" role="img" aria-label={`${label}: ${value} out of 5`}>
            <div className={`fill ${tone}`} style={{ width: `${(value / 5) * 100}%` }} />
          </div>
          <span className="bar-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

export function SettingsDialog({
  settings,
  reason,
  onSave,
  onClose,
}: {
  settings: Settings;
  reason?: string;
  onSave: (next: Settings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ ...draft, apiKey: draft.apiKey.trim(), model: draft.model.trim() || settings.model });
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onSubmit={submit}>
        <h2 id="settings-title">Settings</h2>
        {reason ? <p className="notice">{reason}</p> : null}

        <div className="field">
          <label htmlFor="api-key">Anthropic API key</label>
          <input
            id="api-key"
            ref={first}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-..."
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          />
          <p className="hint">
            Stored only in this browser and sent only to Anthropic. There is no Callback server. Create a key at{" "}
            <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>
            .
          </p>
        </div>

        <div className="field">
          <label htmlFor="model">Model</label>
          <input id="model" type="text" spellCheck={false} value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
        </div>

        <label className="check">
          <input type="checkbox" checked={draft.speakQuestions} onChange={(e) => setDraft({ ...draft, speakQuestions: e.target.checked })} />
          Read questions aloud
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.followUps} onChange={(e) => setDraft({ ...draft, followUps: e.target.checked })} />
          Ask a follow-up after each answer
        </label>

        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
