import { useEffect, useState } from "react";

/** Thin wrappers over the browser's speech features, each with a silent fallback. */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function recognitionSupported(): boolean {
  return typeof window !== "undefined" && recognitionCtor() !== null;
}

export interface Recognizer {
  start(): void;
  stop(): void;
}

/**
 * Continuous dictation. `onText` receives everything finalized so far plus the
 * words still being recognized. Browsers end recognition after a silence, so it
 * is restarted until `stop` is called.
 */
export function createRecognizer(
  onText: (finalText: string, interim: string) => void,
  onBlocked: (reason: string) => void,
): Recognizer {
  const Ctor = recognitionCtor();
  if (!Ctor) return { start() {}, stop() {} };

  let wanted = false;
  let finalText = "";
  let rec: Recognition | null = null;

  const begin = () => {
    const current = new Ctor();
    rec = current;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = `${finalText} ${text}`.trim();
        else interim += text;
      }
      onText(finalText, interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wanted = false;
        onBlocked("Microphone access was blocked. Allow it in your browser, or type your answer.");
      } else if (e.error === "audio-capture") {
        wanted = false;
        onBlocked("No microphone was found. Type your answer instead.");
      } else if (e.error === "network") {
        wanted = false;
        onBlocked("Speech recognition is unavailable right now. Type your answer instead.");
      }
    };
    rec.onend = () => {
      // Only the newest instance may restart, so pause/resume cannot double up.
      if (wanted && rec === current) {
        try {
          begin();
        } catch {
          wanted = false;
        }
      }
    };
    rec.start();
  };

  return {
    start() {
      if (wanted) return;
      wanted = true;
      try {
        begin();
      } catch {
        wanted = false;
        onBlocked("Speech recognition could not start. Type your answer instead.");
      }
    },
    stop() {
      wanted = false;
      try {
        rec?.stop();
      } catch {
        // Already stopped.
      }
    },
  };
}

/** Speaks text aloud, then calls `onEnd`. Returns a function that cancels it. */
export function speak(text: string, onEnd: () => void): () => void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd();
    return () => {};
  }
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(guard);
    onEnd();
  };
  // Some browsers never fire `end`; do not leave the interview stuck.
  const guard = window.setTimeout(finish, 4000 + text.length * 90);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.onend = finish;
  utterance.onerror = finish;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return () => {
    finished = true;
    window.clearTimeout(guard);
    window.speechSynthesis.cancel();
  };
}

const IDLE = 0.08;

/** Live microphone level as `bars` values from 0 to 1, for the voice meter. */
export function useMicLevels(active: boolean, bars = 28): number[] {
  const [levels, setLevels] = useState<number[]>(() => Array(bars).fill(IDLE));

  useEffect(() => {
    if (!active || !navigator.mediaDevices?.getUserMedia) {
      setLevels(Array(bars).fill(IDLE));
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let audio: AudioContext | null = null;
    let timer = 0;

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        audio = new AudioContext();
        const analyser = audio.createAnalyser();
        analyser.fftSize = 256;
        audio.createMediaStreamSource(s).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        timer = window.setInterval(() => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
          const level = Math.min(1, Math.max(IDLE, peak * 2.2));
          // Scroll: newest level enters on the right.
          setLevels((prev) => [...prev.slice(1), level]);
        }, 90);
      })
      .catch(() => {
        // No meter without the microphone; dictation reports its own error.
      });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void audio?.close();
    };
  }, [active, bars]);

  return levels;
}
