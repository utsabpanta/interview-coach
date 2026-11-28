/**
 * The interviewer's voice. Two engines:
 *
 * - "browser": the browser's own speech synthesis, using the most natural
 *   voice installed. Free and private, but quality depends on the browser.
 * - "groq": a neural voice from Groq's text-to-speech API, called with the
 *   visitor's own Groq key. Sounds human; sends the interviewer's words to Groq.
 *
 * If the neural voice fails for any reason, speech falls back to the browser
 * voice so the interview never stalls.
 */

export interface VoiceSettings {
  engine: "browser" | "groq";
  /** `voiceURI` of the chosen browser voice; empty picks the best one available. */
  browserVoice: string;
  groqVoice: string;
}

export const DEFAULT_VOICE: VoiceSettings = { engine: "browser", browserVoice: "", groqVoice: "hannah" };

export const GROQ_TTS_URL = "https://api.groq.com/openai/v1/audio/speech";
export const GROQ_TTS_MODEL = "canopylabs/orpheus-v1-english";
export const GROQ_VOICES: Array<[id: string, label: string]> = [
  ["hannah", "Hannah"],
  ["autumn", "Autumn"],
  ["diana", "Diana"],
  ["austin", "Austin"],
  ["daniel", "Daniel"],
  ["troy", "Troy"],
];

export interface SpeakOptions {
  voice?: VoiceSettings;
  groqKey?: string;
  /** Called once if the neural voice could not be used and the browser voice took over. */
  onFallback?: (reason: string) => void;
}

// Groq's speech model accepts at most 200 characters per request.
const MAX_CHUNK = 180;

/**
 * Splits speech into sentence-sized pieces. Short pieces keep neural requests
 * within limits and stop Chrome from cutting off long utterances mid-sentence.
 */
export function splitForSpeech(text: string, max = MAX_CHUNK): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [];
  const chunks: string[] = [];
  for (const raw of sentences) {
    let sentence = raw.trim();
    if (!sentence) continue;
    // A single very long sentence is broken at commas, then at spaces.
    while (sentence.length > max) {
      const window = sentence.slice(0, max);
      const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
      const at = cut > max * 0.4 ? cut + 1 : window.lastIndexOf(" ") > 0 ? window.lastIndexOf(" ") : max;
      chunks.push(sentence.slice(0, at).trim());
      sentence = sentence.slice(at).trim();
    }
    const last = chunks[chunks.length - 1];
    if (last && last.length + sentence.length + 1 <= max && chunks.length > 0 && sentence.length < 40) {
      chunks[chunks.length - 1] = `${last} ${sentence}`;
    } else if (sentence) {
      chunks.push(sentence);
    }
  }
  return chunks;
}

interface VoiceLike {
  name: string;
  lang: string;
  voiceURI: string;
  localService?: boolean;
  default?: boolean;
}

/** Higher is more natural. Based on which voices browsers ship. */
export function voiceScore(v: VoiceLike): number {
  if (!/^en[-_]?/i.test(v.lang)) return -1;
  const name = v.name;
  let score = 0;
  if (/natural/i.test(name)) score = 100; // Edge's neural "Online (Natural)" voices
  else if (/^Google (US|UK) English/i.test(name)) score = 80; // Chrome's network voices
  else if (/(premium|enhanced|neural)/i.test(name)) score = 70; // macOS and iOS downloaded voices
  else if (/\b(Samantha|Ava|Allison|Susan|Karen|Daniel|Serena|Moira|Tessa)\b/i.test(name)) score = 50; // better built-in Apple voices
  else if (/^Microsoft (Aria|Jenny|Guy|Zira|David)/i.test(name)) score = 40;
  else score = 20;
  if (/^en[-_]US/i.test(v.lang)) score += 5;
  // Novelty and robotic voices.
  if (/(eSpeak|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Zarvox|Trinoids|Whisper|Jester|Organ|Superstar|Fred|Junior|Ralph|Kathy)/i.test(name)) score = 1;
  return score;
}

export function rankVoices<T extends VoiceLike>(voices: T[]): T[] {
  return voices
    .filter((v) => voiceScore(v) >= 0)
    .sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
}

export function browserVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return rankVoices(window.speechSynthesis.getVoices?.() ?? []);
}

function chosenVoice(uri: string | undefined): SpeechSynthesisVoice | null {
  const voices = browserVoices();
  return voices.find((v) => v.voiceURI === uri) ?? voices[0] ?? null;
}

/**
 * Browsers load their voice list in the background. Speaking before it has
 * arrived uses the default voice, which is usually the most robotic one, so
 * the list is requested as early as possible and briefly waited for.
 */
function voicesReady(timeoutMs = 700): Promise<void> {
  const synth = window.speechSynthesis;
  if ((synth.getVoices?.() ?? []).length > 0 || !synth.addEventListener) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      synth.removeEventListener?.("voiceschanged", done);
      resolve();
    };
    const timer = window.setTimeout(done, timeoutMs);
    synth.addEventListener("voiceschanged", done);
  });
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  // Ask for the list at load, long before the first question is spoken.
  window.speechSynthesis.getVoices?.();
}

function speakWithBrowser(chunks: string[], onEnd: () => void, voiceURI?: string): () => void {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || chunks.length === 0) {
    onEnd();
    return () => {};
  }
  let finished = false;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(guard);
    onEnd();
  };
  // Some browsers never fire `end`; do not leave the interview stuck.
  const guard = window.setTimeout(finish, 5000 + total * 100);
  window.speechSynthesis.cancel();
  void voicesReady().then(() => {
    if (finished) return;
    try {
      const voice = chosenVoice(voiceURI);
      chunks.forEach((chunk, i) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        if (voice) {
          utterance.lang = voice.lang;
          try {
            utterance.voice = voice;
          } catch {
            // Keep the default voice if the browser rejects this one.
          }
        }
        // Slightly under full speed sounds less mechanical on most voices.
        utterance.rate = 0.96;
        utterance.pitch = 1;
        if (i === chunks.length - 1) utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
      });
    } catch {
      // Never leave the interview waiting on speech that could not start.
      finish();
    }
  });
  return () => {
    finished = true;
    window.clearTimeout(guard);
    window.speechSynthesis.cancel();
  };
}

// Once the neural voice fails, stop asking for it until the settings change.
let groqBlockedFor = "";

async function fetchSpeech(text: string, key: string, voice: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(GROQ_TTS_URL, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: GROQ_TTS_MODEL, voice, input: text, response_format: "wav" }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      // No readable body.
    }
    throw new Error(detail || `Groq returned an error (${res.status}).`);
  }
  return URL.createObjectURL(await res.blob());
}

function speakWithGroq(chunks: string[], onEnd: () => void, key: string, opts: SpeakOptions): () => void {
  const voice = opts.voice?.groqVoice || DEFAULT_VOICE.groqVoice;
  const controller = new AbortController();
  let cancelled = false;
  let audio: HTMLAudioElement | null = null;
  let cancelFallback: () => void = () => {};

  const play = (url: string) =>
    new Promise<void>((resolve, reject) => {
      audio = new Audio(url);
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("The audio could not be played."));
      audio.play().catch(reject);
    }).finally(() => URL.revokeObjectURL(url));

  void (async () => {
    let i = 0;
    try {
      // Fetch one sentence ahead so there is no gap between sentences.
      let next = fetchSpeech(chunks[0], key, voice, controller.signal);
      for (; i < chunks.length; i++) {
        const url = await next;
        if (cancelled) return;
        if (i + 1 < chunks.length) next = fetchSpeech(chunks[i + 1], key, voice, controller.signal);
        await play(url);
        if (cancelled) return;
      }
      onEnd();
    } catch (err) {
      if (cancelled) return;
      groqBlockedFor = `${key}:${voice}`;
      opts.onFallback?.(err instanceof Error ? err.message : "The natural voice is unavailable.");
      // Carry on from the sentence that failed, in the browser's voice.
      cancelFallback = speakWithBrowser(chunks.slice(i), onEnd, opts.voice?.browserVoice);
    }
  })();

  return () => {
    cancelled = true;
    controller.abort();
    audio?.pause();
    cancelFallback();
  };
}

/** Speaks text aloud, then calls `onEnd`. Returns a function that cancels it. */
export function speak(text: string, onEnd: () => void, opts: SpeakOptions = {}): () => void {
  const chunks = splitForSpeech(text);
  if (chunks.length === 0) {
    onEnd();
    return () => {};
  }
  const key = opts.groqKey?.trim();
  if (opts.voice?.engine === "groq" && key && groqBlockedFor !== `${key}:${opts.voice.groqVoice}`) {
    return speakWithGroq(chunks, onEnd, key, opts);
  }
  return speakWithBrowser(chunks, onEnd, opts.voice?.browserVoice);
}

/** Lets a changed setting try the neural voice again. */
export function resetVoiceFallback(): void {
  groqBlockedFor = "";
}
