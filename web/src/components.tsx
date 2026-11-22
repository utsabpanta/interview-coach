import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { listModels } from "../../src/openai.js";
import { explainError } from "./lib/llm.js";
import { activeBaseUrl, activeKey, missing, PROVIDER_IDS, PROVIDERS } from "./lib/providers.js";
import type { ProviderId, Settings } from "./lib/types.js";

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
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const first = useRef<HTMLSelectElement>(null);

  const id = draft.provider;
  const provider = PROVIDERS[id];
  const isAnthropic = id === "anthropic";
  const editableUrl = id === "custom" || id === "ollama";

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setProvider = (next: ProviderId) => {
    setDraft({ ...draft, provider: next });
    setModels([]);
    setLoadNote(null);
  };

  const loadModels = async () => {
    setLoading(true);
    setLoadNote(null);
    try {
      const found = await listModels({ baseUrl: activeBaseUrl(draft), apiKey: activeKey(draft) || undefined });
      setModels(found);
      setLoadNote(found.length ? `Connected. ${found.length} models available; pick one from the list.` : "Connected, but the server listed no models.");
    } catch (err) {
      setModels([]);
      setLoadNote(explainError(err));
    } finally {
      setLoading(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(draft);
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onSubmit={submit}>
        <h2 id="settings-title">Settings</h2>
        {reason && missing(draft) ? <p className="notice">{missing(draft)}</p> : null}

        <div className="field">
          <label htmlFor="provider">Model provider</label>
          <select id="provider" ref={first} value={id} onChange={(e) => setProvider(e.target.value as ProviderId)}>
            {PROVIDER_IDS.map((p) => (
              <option key={p} value={p}>
                {PROVIDERS[p].label} ({PROVIDERS[p].tag})
              </option>
            ))}
          </select>
          <p className="hint">{provider.note}</p>
        </div>

        {editableUrl ? (
          <div className="field">
            <label htmlFor="base-url">Server address</label>
            <input
              id="base-url"
              type="url"
              spellCheck={false}
              placeholder={provider.baseUrl || "https://example.com/v1"}
              value={draft.baseUrls[id] ?? ""}
              onChange={(e) => setDraft({ ...draft, baseUrls: { ...draft.baseUrls, [id]: e.target.value } })}
            />
            {id === "ollama" ? (
              <p className="hint">
                Ollama must allow this site. Start it with <code>OLLAMA_ORIGINS={window.location.origin} ollama serve</code>, and pull a model
                first, for example <code>ollama pull llama3.2</code>.
              </p>
            ) : null}
          </div>
        ) : null}

        {provider.needsKey || id === "custom" ? (
          <div className="field">
            <label htmlFor="api-key">
              {provider.label.replace(/ \(.*/, "")} API key{provider.needsKey ? "" : " (if the server needs one)"}
            </label>
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft.keys[id] ?? ""}
              onChange={(e) => setDraft({ ...draft, keys: { ...draft.keys, [id]: e.target.value.trim() } })}
            />
            <p className="hint">
              Stored only in this browser and sent only to {isAnthropic ? "Anthropic" : "this provider"}. There is no Callback server.
              {provider.keyUrl ? (
                <>
                  {" "}
                  Get a key at{" "}
                  <a href={provider.keyUrl} target="_blank" rel="noreferrer">
                    {new URL(provider.keyUrl).hostname}
                  </a>
                  .
                </>
              ) : null}
            </p>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="model">Model</label>
          <div className="row nowrap">
            <input
              id="model"
              type="text"
              list="model-options"
              spellCheck={false}
              placeholder={provider.defaultModel || "model name"}
              value={draft.models[id] ?? ""}
              onChange={(e) => setDraft({ ...draft, models: { ...draft.models, [id]: e.target.value.trim() } })}
            />
            {isAnthropic ? null : (
              <button type="button" className="btn ghost small" onClick={() => void loadModels()} disabled={loading || !activeBaseUrl(draft)}>
                {loading ? "Checking..." : "Check connection"}
              </button>
            )}
          </div>
          <datalist id="model-options">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <p className="hint" role="status">
            {loadNote ??
              (provider.defaultModel
                ? `Leave empty to use ${provider.defaultModel}. Model names change; check the connection to see what is available now.`
                : "Check the connection to see which models the server offers.")}
          </p>
        </div>

        {isAnthropic || id === "ollama" ? null : (
          <p className="hint">Free tiers may use what you send to improve their services. Check the provider's terms before pasting anything private.</p>
        )}

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
