/**
 * Understanding what the candidate just said without a model call, so the
 * interviewer can react instantly to things like "can you repeat the question?".
 * Pure and browser-safe.
 */

export type Intent = "repeat" | "done" | null;

const MAX_REQUEST_WORDS = 14;

const LEAD = String.raw`(?:(?:sorry|pardon(?: me)?|excuse me|wait|hey|okay|ok|um+|uh+|hmm+)[,.!\s]+)*`;

// A request to hear the question again. Anchored to the start so that an answer
// which merely contains "repeat" ("I had to repeat that migration") does not match.
const REPEAT = new RegExp(
  [
    String.raw`^${LEAD}(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:repeat|say|ask)\b[^.?!]*\b(?:question|that|it|again)\b`,
    String.raw`^${LEAD}(?:what was|what's|what is) (?:the|your) question`,
    String.raw`^${LEAD}(?:come again|once more|one more time|say again)\b`,
    String.raw`^${LEAD}i (?:did not|didn'?t|couldn'?t|could not) (?:quite )?(?:catch|hear|get) (?:that|you|it|the question|the last part)`,
    String.raw`^(?:sorry|pardon(?: me)?)[,.]?\s*(?:what)?[?.!]*$`,
  ].join("|"),
  "i",
);

// A spoken sign-off at the end of an answer.
const DONE = /(?:^|[\s,.;])(?:(?:and |so |okay |ok )?(?:that'?s|that is) (?:it|all|my answer|everything)(?: from me)?|i'?m (?:done|finished))[.!\s]*$/i;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function detectIntent(text: string): Intent {
  const said = text.trim();
  if (!said) return null;
  if (wordCount(said) <= MAX_REQUEST_WORDS && REPEAT.test(said)) return "repeat";
  if (DONE.test(said)) return "done";
  return null;
}

/** Removes a spoken sign-off ("...and that's my answer") from the end of an answer. */
export function stripSignOff(text: string): string {
  return text.replace(DONE, "").trim();
}

const QUICK_MS = 1400;
const THOUGHTFUL_MS = 3500;

/**
 * How long a silence should last before the interviewer takes its turn.
 * Short requests and questions get a quick reply; an answer gets room for
 * the candidate to think mid-sentence.
 */
export function pauseBeforeReply(text: string): number {
  const said = text.trim();
  if (detectIntent(said)) return QUICK_MS;
  if (wordCount(said) <= 15 && /\?\s*$/.test(said)) return QUICK_MS;
  return THOUGHTFUL_MS;
}
