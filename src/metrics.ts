/**
 * Deterministic delivery metrics, computed locally with no model call.
 * Most useful on transcripts of spoken answers, where filler words survive.
 */

export interface DeliveryMetrics {
  words: number;
  /** Estimated speaking time at a conversational pace. */
  estimatedMinutes: number;
  fillerCount: number;
  /** Fillers per 100 words. */
  fillerRate: number;
  fillers: Record<string, number>;
  /** Share of first-person pronouns that are "I" rather than "we" (0..1), or null if none. */
  ownershipRatio: number | null;
  notes: string[];
}

const WORDS_PER_MINUTE = 140;

const FILLERS: Array<[label: string, pattern: RegExp]> = [
  ["um", /\bu+m+\b/gi],
  ["uh", /\bu+h+\b/gi],
  ["er", /\be+r+\b/gi],
  ["you know", /\byou know\b/gi],
  ["I mean", /\bi mean\b/gi],
  ["basically", /\bbasically\b/gi],
  ["actually", /\bactually\b/gi],
  ["literally", /\bliterally\b/gi],
  ["kind of", /\bkind of\b/gi],
  ["sort of", /\bsort of\b/gi],
  // "like" only when set off as a verbal tic, not as a verb or comparison.
  ["like", /(?:,\s*like,|\blike,)/gi],
];

/** Target speaking time in minutes for one answer, by interview type. */
export const LENGTH_TARGETS: Record<string, [min: number, max: number]> = {
  behavioral: [1, 2.5],
  technical: [1, 3],
  "system-design": [2, 5],
};

export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export function analyzeDelivery(answer: string, type = "behavioral"): DeliveryMetrics {
  const words = countWords(answer);
  const estimatedMinutes = Math.round((words / WORDS_PER_MINUTE) * 10) / 10;

  const fillers: Record<string, number> = {};
  let fillerCount = 0;
  for (const [label, pattern] of FILLERS) {
    const n = (answer.match(pattern) ?? []).length;
    if (n > 0) {
      fillers[label] = n;
      fillerCount += n;
    }
  }
  const fillerRate = words === 0 ? 0 : Math.round((fillerCount / words) * 1000) / 10;

  const i = (answer.match(/\bI\b/g) ?? []).length;
  const we = (answer.match(/\bwe\b/gi) ?? []).length;
  const ownershipRatio = i + we === 0 ? null : Math.round((i / (i + we)) * 100) / 100;

  const notes: string[] = [];
  const [min, max] = LENGTH_TARGETS[type] ?? LENGTH_TARGETS.behavioral;
  if (words > 0 && estimatedMinutes < min) {
    notes.push(`Short: about ${estimatedMinutes} min spoken; aim for ${min}-${max} min.`);
  } else if (estimatedMinutes > max) {
    notes.push(`Long: about ${estimatedMinutes} min spoken; aim for ${min}-${max} min.`);
  }
  if (fillerRate >= 3) {
    notes.push(`Filler words are frequent (${fillerRate} per 100 words).`);
  }
  if (type === "behavioral" && ownershipRatio !== null && i + we >= 5 && ownershipRatio < 0.4) {
    notes.push(`Mostly "we" (${we}) over "I" (${i}); make your own contribution explicit.`);
  }

  return { words, estimatedMinutes, fillerCount, fillerRate, fillers, ownershipRatio, notes };
}
