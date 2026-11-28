import { PATIENCE_MS } from "../../../src/intents.js";
import { PROVIDERS } from "./providers.js";
import { DEFAULT_VOICE } from "./voice.js";
import type { SessionSummary, Settings } from "./types.js";

/**
 * Everything the app remembers lives in this browser's localStorage.
 * Storage can be unavailable (private mode, blocked), so every access is guarded.
 */

const SETTINGS_KEY = "callback.settings.v1";
const HISTORY_KEY = "callback.history.v1";
const HISTORY_LIMIT = 100;

export const DEFAULT_SETTINGS: Settings = {
  provider: "groq",
  keys: {},
  models: {},
  baseUrls: {},
  speakQuestions: true,
  followUps: true,
  handsFree: true,
  patience: "normal",
  voice: DEFAULT_VOICE,
  rememberKeys: true,
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Carry on in memory only.
  }
}

/** Settings from before providers existed held a single Anthropic key and model. */
interface LegacySettings {
  apiKey?: string;
  model?: string;
}

const KEYS_KEY = "callback.keys.v1";

function readSessionKeys(): Settings["keys"] {
  try {
    const raw = sessionStorage.getItem(KEYS_KEY);
    return raw ? (JSON.parse(raw) as Settings["keys"]) : {};
  } catch {
    return {};
  }
}

export function loadSettings(): Settings {
  const saved = read<Partial<Settings> & LegacySettings>(SETTINGS_KEY) ?? {};
  const { apiKey, model, ...rest } = saved;
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...rest,
    // Keys kept only for this tab live in sessionStorage.
    keys: { ...(rest.keys ?? {}), ...readSessionKeys() },
    models: { ...(rest.models ?? {}) },
    baseUrls: { ...(rest.baseUrls ?? {}) },
    voice: { ...DEFAULT_VOICE, ...(rest.voice ?? {}) },
  };
  if (settings.voice.engine !== "groq") settings.voice.engine = "browser";
  if (apiKey && !rest.provider) {
    settings.provider = "anthropic";
    settings.keys.anthropic = apiKey;
    if (model) settings.models.anthropic = model;
  }
  if (!(settings.provider in PROVIDERS)) settings.provider = DEFAULT_SETTINGS.provider;
  if (!(settings.patience in PATIENCE_MS)) settings.patience = DEFAULT_SETTINGS.patience;
  return settings;
}

/**
 * Saves settings. With "remember keys" off, keys are written only to
 * sessionStorage, which the browser clears when the tab is closed.
 */
export function saveSettings(settings: Settings): void {
  if (settings.rememberKeys) {
    write(SETTINGS_KEY, settings);
    try {
      sessionStorage.removeItem(KEYS_KEY);
    } catch {
      // Nothing to remove.
    }
    return;
  }
  write(SETTINGS_KEY, { ...settings, keys: {} });
  try {
    sessionStorage.setItem(KEYS_KEY, JSON.stringify(settings.keys));
  } catch {
    // Keys stay in memory for this page only.
  }
}

export function loadHistory(): SessionSummary[] {
  const items = read<SessionSummary[]>(HISTORY_KEY);
  return Array.isArray(items) ? items.filter((x) => x && typeof x.readiness === "number") : [];
}

export function saveToHistory(summary: SessionSummary): SessionSummary[] {
  const next = [...loadHistory().filter((h) => h.id !== summary.id), summary].slice(-HISTORY_LIMIT);
  write(HISTORY_KEY, next);
  return next;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // Nothing to clear.
  }
}
