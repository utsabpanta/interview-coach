import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Patience } from "../../src/intents.js";
import { listModels } from "../../src/openai.js";
import { explainError } from "./lib/llm.js";
import { ON_DEVICE_MODELS, onDeviceSupported } from "./lib/localLlm.js";
import { activeBaseUrl, activeKey, missing, PROVIDER_IDS, PROVIDERS } from "./lib/providers.js";
import type { ProviderId, Settings } from "./lib/types.js";
import { browserVoices, GROQ_VOICES, resetVoiceFallback, speak, type VoiceSettings } from "./lib/voice.js";

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
  historyCount,
  onSave,
  onClose,
  onClearHistory,
}: {
  settings: Settings;
  reason?: string;
  /** Number of saved practice sessions, to enable the delete control. */
  historyCount: number;
  onSave: (next: Settings) => void;
  onClose: () => void;
  onClearHistory: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [cleared, setCleared] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const first = useRef<HTMLSelectElement>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const stopPreview = useRef<() => void>(() => {});

  const id = draft.provider;
  const provider = PROVIDERS[id];
  const hasKeys = Object.values(draft.keys).some((k) => (k ?? "").trim());
  const isAnthropic = id === "anthropic";
  const editableUrl = id === "custom" || id === "ollama";

  const form = useRef<HTMLFormElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // A modal dialog: focus moves in, stays in while it is open, and goes back
  // to where it was when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close.current();
        return;
      }
      if (e.key !== "Tab" || !form.current) return;
      const items = [...form.current.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea")].filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstItem || !form.current.contains(active))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (active === lastItem || !form.current.contains(active))) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);

  const setProvider = (next: ProviderId) => {
    setDraft({ ...draft, provider: next });
    setModels([]);
    setLoadNote(null);
  };

  // Browsers load their voice list late, and announce it with an event.
  useEffect(() => {
    const load = () => setVoices(browserVoices());
    load();
    window.speechSynthesis?.addEventListener?.("voiceschanged", load);
    return () => {
      window.speechSynthesis?.removeEventListener?.("voiceschanged", load);
      stopPreview.current();
    };
  }, []);

  const setVoice = (patch: Partial<VoiceSettings>) => {
    resetVoiceFallback();
    setVoiceNote(null);
    setDraft((d) => ({ ...d, voice: { ...d.voice, ...patch } }));
  };

  const preview = () => {
    stopPreview.current();
    resetVoiceFallback();
    if (draft.voice.engine === "groq" && !(draft.keys.groq ?? "").trim()) {
      setVoiceNote("Add a Groq API key to hear the natural voice.");
      return;
    }
    setVoiceNote(null);
    stopPreview.current = speak("Thanks for joining. Walk me through a recent project you owned, and which decisions were yours.", () => {}, {
      voice: draft.voice,
      groqKey: draft.keys.groq,
      onFallback: (reason) => setVoiceNote(`The natural voice did not work, so you are hearing the browser voice. ${reason}`),
    });
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
    stopPreview.current();
    resetVoiceFallback();
    onSave(draft);
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={form} className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onSubmit={submit}>
        <h2 id="settings-title">Settings</h2>
        {reason && missing(draft) ? (
          <p className="notice">
            {missing(draft)} No key? Choose "On this device" to run a model in your browser.
          </p>
        ) : null}

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

        {id === "ondevice" ? (
          <div className="field">
            <label htmlFor="device-model">Model</label>
            <select
              id="device-model"
              value={draft.models.ondevice || ON_DEVICE_MODELS[0].id}
              onChange={(e) => setDraft({ ...draft, models: { ...draft.models, ondevice: e.target.value } })}
            >
              {ON_DEVICE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="hint" role="status">
              {onDeviceSupported()
                ? "The model is downloaded once, when you start your first interview, and then kept by your browser."
                : "This browser cannot run a model on your device (WebGPU is not available). Use a recent Chrome or Edge on a computer, or pick another provider."}
            </p>
          </div>
        ) : (
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
        )}

        {isAnthropic || id === "ollama" || id === "ondevice" ? null : (
          <p className="hint">Free tiers may use what you send to improve their services. Check the provider's terms before pasting anything private.</p>
        )}

        <fieldset className="voice">
          <legend>Interviewer's voice</legend>
          <div className="field">
            <label htmlFor="voice-engine">Voice type</label>
            <select id="voice-engine" value={draft.voice.engine} onChange={(e) => setVoice({ engine: e.target.value as VoiceSettings["engine"] })}>
              <option value="browser">Browser voice (free, private)</option>
              <option value="groq">Natural voice by Groq (uses your Groq key)</option>
            </select>
          </div>

          {draft.voice.engine === "groq" ? (
            <>
              {id === "groq" ? null : (
                <div className="field">
                  <label htmlFor="groq-voice-key">Groq API key for the voice</label>
                  <input
                    id="groq-voice-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft.keys.groq ?? ""}
                    onChange={(e) => setDraft({ ...draft, keys: { ...draft.keys, groq: e.target.value.trim() } })}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor="groq-voice">Voice</label>
                <select id="groq-voice" value={draft.voice.groqVoice} onChange={(e) => setVoice({ groqVoice: e.target.value })}>
                  {GROQ_VOICES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <p className="hint">
                  A neural voice that sounds human. The interviewer's words are sent to Groq to be spoken, and Groq may ask you to accept the
                  voice model's terms in its console first. If it fails, the browser voice takes over.
                </p>
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor="browser-voice">Voice</label>
              <select id="browser-voice" value={draft.voice.browserVoice} onChange={(e) => setVoice({ browserVoice: e.target.value })}>
                <option value="">Automatic: {voices[0]?.name ?? "the browser default"}</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              <p className="hint">
                Listed most natural first. Voices come from your browser and system: Edge has the most natural free ones, Chrome's "Google"
                voices are next, and on a Mac you can download better ones in System Settings under Accessibility, Spoken Content.
              </p>
            </div>
          )}

          <div className="row">
            <button type="button" className="btn ghost small" onClick={preview}>
              {Icon.speaker}
              Hear this voice
            </button>
            {voiceNote ? (
              <span className="hint" role="status">
                {voiceNote}
              </span>
            ) : null}
          </div>
        </fieldset>

        <label className="check">
          <input type="checkbox" checked={draft.speakQuestions} onChange={(e) => setDraft({ ...draft, speakQuestions: e.target.checked })} />
          Read questions aloud
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.followUps} onChange={(e) => setDraft({ ...draft, followUps: e.target.checked })} />
          Two-way conversation: the interviewer replies and probes
        </label>

        <label className="check">
          <input type="checkbox" checked={draft.handsFree} onChange={(e) => setDraft({ ...draft, handsFree: e.target.checked })} />
          Hands-free: the interviewer replies when I stop talking
        </label>

        <div className="field">
          <label htmlFor="patience">How long the interviewer waits after you stop talking</label>
          <select id="patience" value={draft.patience} disabled={!draft.handsFree} onChange={(e) => setDraft({ ...draft, patience: e.target.value as Patience })}>
            <option value="short">Short, about 3.5 seconds</option>
            <option value="normal">Normal, about 5.5 seconds</option>
            <option value="long">Long, about 8 seconds</option>
          </select>
          <p className="hint">It waits longer when you have only just started or stopped mid-sentence.</p>
        </div>

        <label className="check">
          <input type="checkbox" checked={draft.rememberKeys} onChange={(e) => setDraft({ ...draft, rememberKeys: e.target.checked })} />
          Remember my API keys on this device
        </label>
        <p className="hint">
          Keys are stored in this browser, where other pages on this website's address could read them. Turn this off to keep them only until
          you close the tab, and prefer free-tier keys or keys with a spending limit.
        </p>

        <div className="danger-zone">
          <div className="row">
            <button
              type="button"
              className="btn ghost small"
              disabled={!hasKeys}
              onClick={() => {
                setDraft({ ...draft, keys: {} });
                setCleared("Keys removed. Press Save to confirm.");
              }}
            >
              Remove saved API keys
            </button>
            <button
              type="button"
              className="btn ghost small"
              disabled={historyCount === 0}
              onClick={() => {
                onClearHistory();
                setCleared("Practice history deleted.");
              }}
            >
              Delete practice history
            </button>
          </div>
          {cleared ? (
            <p className="hint" role="status">
              {cleared}
            </p>
          ) : null}
        </div>

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
