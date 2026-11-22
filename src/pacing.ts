/** Pacing analysis from timestamps. Pure and browser-safe: no Node imports. */
import { countWords, LENGTH_TARGETS } from "./metrics.js";

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  text: string;
  /** Length of the recording in seconds. */
  duration: number;
  segments: Segment[];
}

export interface Pacing {
  durationSeconds: number;
  wordsPerMinute: number;
  /** Silences of at least LONG_PAUSE_SECONDS between segments. */
  longPauses: number;
  longestPauseSeconds: number;
  notes: string[];
}

const LONG_PAUSE_SECONDS = 2;
const SLOW_WPM = 120;
const FAST_WPM = 170;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Pacing from real timestamps. Pure: no I/O. */
export function analyzePacing(t: Transcript, type = "behavioral"): Pacing {
  const words = countWords(t.text);
  const durationSeconds = round1(t.duration);
  const wordsPerMinute = t.duration > 0 ? Math.round(words / (t.duration / 60)) : 0;

  let longPauses = 0;
  let longest = 0;
  for (let i = 1; i < t.segments.length; i++) {
    const gap = t.segments[i].start - t.segments[i - 1].end;
    if (gap > longest) longest = gap;
    if (gap >= LONG_PAUSE_SECONDS) longPauses++;
  }

  const notes: string[] = [];
  const minutes = round1(t.duration / 60);
  const [min, max] = LENGTH_TARGETS[type] ?? LENGTH_TARGETS.behavioral;
  if (t.duration > 0 && minutes < min) notes.push(`Short: ${minutes} min; aim for ${min}-${max} min.`);
  else if (minutes > max) notes.push(`Long: ${minutes} min; aim for ${min}-${max} min.`);
  if (wordsPerMinute > 0 && wordsPerMinute < SLOW_WPM) {
    notes.push(`Slow pace (${wordsPerMinute} wpm); ${SLOW_WPM}-${FAST_WPM} wpm sounds confident.`);
  } else if (wordsPerMinute > FAST_WPM) {
    notes.push(`Fast pace (${wordsPerMinute} wpm); slow down toward ${SLOW_WPM}-${FAST_WPM} wpm.`);
  }
  if (longPauses > 0) {
    notes.push(`${longPauses} long pause${longPauses === 1 ? "" : "s"} (longest ${round1(longest)}s).`);
  }

  return { durationSeconds, wordsPerMinute, longPauses, longestPauseSeconds: round1(longest), notes };
}
