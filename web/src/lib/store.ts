import type { SessionSummary, Settings } from "./types.js";

/**
 * Everything the app remembers lives in this browser's localStorage.
 * Storage can be unavailable (private mode, blocked), so every access is guarded.
 */

const SETTINGS_KEY = "callback.settings.v1";
const HISTORY_KEY = "callback.history.v1";
const HISTORY_LIMIT = 100;

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  model: "claude-sonnet-5-5",
  speakQuestions: true,
  followUps: true,
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

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...(read<Partial<Settings>>(SETTINGS_KEY) ?? {}) };
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
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
