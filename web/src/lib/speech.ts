import { useEffect, useRef, useState } from "react";

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

// Consecutive failed sessions, with nothing heard between them, before giving up on voice.
const MAX_FAILURES = 5;

export interface Recognizer {
  start(): void;
  stop(): void;
}

/**
 * Continuous dictation. `onText` receives everything finalized so far, the
 * words still being recognized, and the most recently finalized phrase.
 * Browsers end recognition after a silence, so it is restarted until `stop`
 * is called. `initial` seeds the transcript, to carry on an earlier answer.
 */
export function createRecognizer(
  onText: (finalText: string, interim: string, lastSegment: string) => void,
  onBlocked: (reason: string) => void,
  initial = "",
): Recognizer {
  const Ctor = recognitionCtor();
  if (!Ctor) return { start() {}, stop() {} };

  let wanted = false;
  let finalText = initial.trim();
  let lastSegment = "";
  let rec: Recognition | null = null;
  // Browsers end a dictation session after about a minute, and sessions also
  // fail for passing reasons. Each is restarted; only a run of failures with
  // nothing heard in between means dictation really is unavailable.
  let failures = 0;
  let retry = 0;

  const giveUp = (reason: string) => {
    wanted = false;
    window.clearTimeout(retry);
    onBlocked(reason);
  };

  const restart = () => {
    window.clearTimeout(retry);
    if (!wanted) return;
    if (failures >= MAX_FAILURES) {
      giveUp("Speech recognition keeps stopping. Type your answer instead; what you said so far is kept.");
      return;
    }
    // Back off a little more after each failure, so a brief outage can pass.
    retry = window.setTimeout(() => {
      if (!wanted) return;
      try {
        begin();
      } catch {
        failures += 1;
        restart();
      }
    }, failures === 0 ? 0 : Math.min(2000, 250 * 2 ** failures));
  };

  const begin = () => {
    const current = new Ctor();
    rec = current;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      // Hearing anything proves dictation is working again.
      failures = 0;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalText = `${finalText} ${text}`.trim();
          if (text.trim()) lastSegment = text.trim();
        } else interim += text;
      }
      onText(finalText, interim.trim(), lastSegment);
    };
    rec.onerror = (e) => {
      if (rec !== current) return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        giveUp("Microphone access was blocked. Allow it in your browser, or type your answer.");
      } else if (e.error === "audio-capture") {
        giveUp("No microphone was found. Type your answer instead.");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        // "network" and similar errors are usually momentary; count them and let `onend` restart.
        failures += 1;
      }
    };
    rec.onend = () => {
      // Only the newest instance may restart, so pause/resume cannot double up.
      if (wanted && rec === current) restart();
    };
    rec.start();
  };

  return {
    start() {
      if (wanted) return;
      wanted = true;
      failures = 0;
      try {
        begin();
      } catch {
        failures += 1;
        restart();
      }
    },
    stop() {
      wanted = false;
      window.clearTimeout(retry);
      try {
        rec?.stop();
      } catch {
        // Already stopped.
      }
    },
  };
}

const IDLE = 0.08;

/**
 * Live microphone level as `bars` values from 0 to 1, for the voice meter.
 * `onVoice` fires whenever the microphone hears something clearly above the
 * room's background noise, which is a faster and more reliable sign that the
 * candidate is still talking than waiting for recognized words.
 */
export function useMicLevels(active: boolean, bars = 28, onVoice?: () => void): number[] {
  const [levels, setLevels] = useState<number[]>(() => Array(bars).fill(IDLE));
  const voice = useRef(onVoice);
  voice.current = onVoice;

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
        // A slowly adapting estimate of the room's background level.
        let floor = 0.02;
        timer = window.setInterval(() => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
          if (peak > floor * 3 + 0.03) voice.current?.();
          else floor = floor * 0.95 + peak * 0.05;
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
