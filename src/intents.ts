/**
 * Understanding what the candidate just said without a model call, so the
 * interviewer can react instantly to things like "can you repeat the question?".
 * Pure and browser-safe.
 *
 * The rule throughout: when in doubt, it is an answer. Wrongly treating an
 * answer as a request throws the candidate's words away, which is far worse
 * than sending a request to the model, which can handle it.
 */

export type Intent = "repeat" | "done" | null;

const MAX_REQUEST_WORDS = 14;

const LEAD = String.raw`(?:(?:i'?m sorry|i am sorry|sorry|pardon(?: me)?|excuse me|wait|hey|okay|ok|yeah|yes|actually|so|well|um+|uh+|hmm+)[,.!\s]+)*`;
const THING = String.raw`(?:that|it|this|the question|your question|the last (?:part|bit))`;
const AGAIN = String.raw`(?:\s+(?:again|one more time|once more))?`;
const END = String.raw`(?:[,\s]+please)?[?.!\s]*$`;

// Requests to hear the question again. Every pattern must match the WHOLE
// utterance, so an answer that merely starts like a request ("I didn't catch
// that bug until production", "Say it was a Tuesday...") is never matched.
const REPEAT = new RegExp(
  [
    String.raw`^${LEAD}(?:can|could|would|will) you\s+(?:please\s+|just\s+)?(?:repeat|say|ask)(?:\s+me)?\s+${THING}${AGAIN}${END}`,
    String.raw`^${LEAD}(?:please\s+)?repeat(?:\s+${THING})?${AGAIN}${END}`,
    String.raw`^${LEAD}(?:can|could|may) i\s+(?:hear|get)\s+${THING}${AGAIN}${END}`,
    String.raw`^${LEAD}(?:would|do) you mind\s+(?:repeating|saying)\s+${THING}${AGAIN}${END}`,
    String.raw`^${LEAD}(?:what was|what's|what is)\s+(?:the|your)\s+question${AGAIN}${END}`,
    String.raw`^${LEAD}what was that${AGAIN}${END}`,
    String.raw`^${LEAD}(?:come again|say (?:that|it) again|one more time|once more)${END}`,
    String.raw`^${LEAD}i\s+(?:did not|didn'?t|couldn'?t|could not)\s+(?:quite\s+)?(?:catch|hear)\s+(?:that|you|it|the question|the last (?:part|bit))${END}`,
    String.raw`^(?:pardon(?: me)?|what|sorry what)[?.!\s]*$`,
  ].join("|"),
  "i",
);

// Sign-offs nobody says mid-story. Honored at the end of any answer.
const STRONG_DONE =
  /[\s,;]*(?:\b(?:and|so|okay|ok|yeah)\s+)?\b(?:(?:that'?s|that is) my answer|i'?m (?:done|finished) with (?:my|that|the) answer|(?:that'?s|that is) all i (?:have|got)|(?:that'?s|that is) (?:pretty much|about) it|i think that covers it|(?:that'?s|that is) (?:it|all|everything) from me)[.!\s]*$/i;

// Sign-offs that also turn up inside stories ("...he said that's it"). Honored
// only when said on their own, as a separate phrase after a pause.
const WEAK_DONE = /^(?:(?:and|so|okay|ok|yeah)[,\s]+)?(?:(?:that'?s|that is) (?:it|all|everything)|i'?m (?:done|finished))[.!\s]*$/i;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * `lastSegment` is the most recent phrase the speech recognizer finalized,
 * when known. It lets a short sign-off count only when it stood alone.
 */
export function detectIntent(text: string, lastSegment?: string): Intent {
  const said = text.trim();
  if (!said) return null;
  if (wordCount(said) <= MAX_REQUEST_WORDS && REPEAT.test(said)) return "repeat";
  if (STRONG_DONE.test(said)) return "done";
  const alone = (lastSegment ?? said).trim();
  if (alone && WEAK_DONE.test(alone) && said.endsWith(alone)) return "done";
  return null;
}

/** Removes a spoken sign-off from the end of an answer; anything else is left untouched. */
export function stripSignOff(text: string, lastSegment?: string): string {
  const said = text.trim();
  if (STRONG_DONE.test(said)) return said.replace(STRONG_DONE, "").trim();
  const alone = (lastSegment ?? said).trim();
  if (alone && WEAK_DONE.test(alone) && said.endsWith(alone)) return said.slice(0, said.length - alone.length).trim();
  return said;
}

/** How long the interviewer waits through silence before replying, by setting. */
export const PATIENCE_MS = { short: 3500, normal: 5500, long: 8000 } as const;
export type Patience = keyof typeof PATIENCE_MS;

const QUICK_MS = 1500;
// Words that cannot end a finished thought: the candidate is mid-sentence.
const TRAILING = /\b(?:and|but|so|because|or|then|like|um+|uh+|the|a|an|to|of|that|which|when|if|with|for|is|was|were|are|i|we|my|our|in|on|at|by|from|as|well)[,\s]*$/i;

/**
 * How long a silence should last before the interviewer takes its turn.
 * Requests get a quick reply. An answer gets the full patience, and more when
 * the candidate has barely started or stopped mid-sentence.
 */
export function pauseBeforeReply(text: string, patienceMs: number = PATIENCE_MS.normal, lastSegment?: string): number {
  const said = text.trim();
  if (detectIntent(said, lastSegment)) return QUICK_MS;
  if (wordCount(said) <= 15 && /\?\s*$/.test(said)) return QUICK_MS;
  let wait = patienceMs;
  if (TRAILING.test(said)) wait += 3000;
  if (wordCount(said) < 6) wait += 2000;
  return wait;
}
