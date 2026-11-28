import type { Exchange, Feedback, InterviewType, PlannedQuestion } from "../../../src/coach.js";
import type { Patience } from "../../../src/intents.js";
import type { DeliveryMetrics } from "../../../src/metrics.js";
import type { Pacing } from "../../../src/pacing.js";
import type { VoiceSettings } from "./voice.js";

export interface Setup {
  jobDescription: string;
  resume: string;
  type: InterviewType;
}

/** One spoken (or typed) answer to a question, with its follow-up and feedback. */
export interface Attempt {
  exchanges: Exchange[];
  feedback: Feedback;
  metrics: DeliveryMetrics;
  pacing: Pacing;
}

export interface Round {
  question: string;
  competency: string;
  attempts: Attempt[];
}

export interface Session {
  id: string;
  startedAt: string;
  role: string;
  /** The interviewer's spoken opening for the round. */
  intro: string;
  type: InterviewType;
  setup: Setup;
  /** Set when the session is a focused drill on one competency. */
  drill?: string;
  plan: PlannedQuestion[];
  index: number;
  /** Indexed like `plan`; skipped questions leave a gap. */
  rounds: Array<Round | undefined>;
}

/** What is kept in the browser after a session ends. Scores only, no answers. */
export interface SessionSummary {
  id: string;
  date: string;
  role: string;
  type: InterviewType;
  readiness: number;
  answers: number;
  skills: Array<{ competency: string; score: number }>;
}

export type ProviderId = "groq" | "gemini" | "openrouter" | "ollama" | "anthropic" | "custom";

export interface Settings {
  provider: ProviderId;
  /** Per provider, so switching back does not lose a key. */
  keys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
  baseUrls: Partial<Record<ProviderId, string>>;
  speakQuestions: boolean;
  followUps: boolean;
  /** The interviewer replies on its own when the candidate stops talking. */
  handsFree: boolean;
  /** How long the interviewer waits through silence before replying. */
  patience: Patience;
  /** How the interviewer's words are spoken. */
  voice: VoiceSettings;
}
