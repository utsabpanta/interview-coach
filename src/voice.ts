import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

export { analyzePacing, type Pacing, type Segment, type Transcript } from "./pacing.js";
import type { Segment, Transcript } from "./pacing.js";

const DEFAULT_URL = "https://api.openai.com/v1/audio/transcriptions";

/**
 * Transcribes audio through an OpenAI-compatible transcription endpoint.
 * Defaults to OpenAI's Whisper API; set COACH_TRANSCRIBE_URL to use another
 * compatible server, such as a local Whisper server.
 */
export async function transcribe(file: string): Promise<Transcript> {
  const url = process.env.COACH_TRANSCRIBE_URL ?? DEFAULT_URL;
  const key = process.env.OPENAI_API_KEY;
  if (!key && url === DEFAULT_URL) {
    throw new Error(
      "Transcription needs OPENAI_API_KEY, or COACH_TRANSCRIBE_URL pointing at an OpenAI-compatible transcription server.",
    );
  }

  const form = new FormData();
  form.append("file", new Blob([await readFile(file)]), path.basename(file));
  form.append("model", process.env.COACH_TRANSCRIBE_MODEL ?? "whisper-1");
  form.append("response_format", "verbose_json");

  const res = await fetch(url, {
    method: "POST",
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    body: form,
  }).catch(() => {
    throw new Error(`Could not reach the transcription server at ${url}.`);
  });
  if (!res.ok) {
    throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return parseTranscript(await res.json());
}

/** Normalizes a verbose_json transcription response. */
export function parseTranscript(body: unknown): Transcript {
  const b = (body ?? {}) as { text?: unknown; duration?: unknown; segments?: unknown };
  const segments: Segment[] = Array.isArray(b.segments)
    ? b.segments.flatMap((s: { start?: unknown; end?: unknown; text?: unknown }) =>
        typeof s?.start === "number" && typeof s?.end === "number"
          ? [{ start: s.start, end: s.end, text: String(s.text ?? "").trim() }]
          : [],
      )
    : [];
  const text = typeof b.text === "string" ? b.text.trim() : segments.map((s) => s.text).join(" ");
  const duration = Number(b.duration) || (segments.length ? segments[segments.length - 1].end : 0);
  if (!text) throw new Error("The transcription came back empty.");
  return { text, duration, segments };
}

function micInput(): string[] {
  const custom = process.env.COACH_FFMPEG_INPUT;
  if (custom) return custom.split(/\s+/).filter(Boolean);
  if (process.platform === "darwin") return ["-f", "avfoundation", "-i", ":default"];
  if (process.platform === "linux") return ["-f", "pulse", "-i", "default"];
  throw new Error(
    'Recording is not preconfigured on this platform. Set COACH_FFMPEG_INPUT (for example: -f dshow -i audio="Microphone"), or record separately and pass --audio.',
  );
}

/** Records the default microphone with ffmpeg until `stop` resolves. */
export async function record(outFile: string, stop: Promise<void>): Promise<void> {
  const args = ["-y", "-loglevel", "error", ...micInput(), "-ac", "1", "-ar", "16000", outFile];
  const child = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));

  const finished = new Promise<void>((resolve, reject) => {
    child.on("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "ENOENT" ? new Error("ffmpeg was not found. Install it, or pass --audio with an existing recording.") : err),
    );
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg could not record: ${stderr.trim().slice(0, 300) || `exit code ${code}`}`)),
    );
  });

  // "q" asks ffmpeg to finish the file cleanly.
  void stop.then(() => child.stdin.write("q"), () => child.kill());
  await finished;
}
