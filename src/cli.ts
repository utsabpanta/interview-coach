#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Command, InvalidArgumentError } from "commander";
import { buildStories, evaluate, INTERVIEW_TYPES, type InterviewType } from "./coach.js";
import { AnthropicLLM } from "./llm.js";
import { analyzeDelivery } from "./metrics.js";
import { runMock, type IO } from "./mock.js";
import { checkDeck, DOC_KINDS, planDeck, renderDeck, renderStoryline, writeDoc, type DocKind } from "./pipeline.js";
import { renderProgress, summarize } from "./progress.js";
import { loadSessions, overallScore, renderFeedback, saveSession, type Session } from "./session.js";
import { analyzePacing, record, transcribe } from "./voice.js";

function parseType(value: string): InterviewType {
  if (!INTERVIEW_TYPES.includes(value as InterviewType)) {
    throw new InvalidArgumentError(`Choose one of: ${INTERVIEW_TYPES.join(", ")}.`);
  }
  return value as InterviewType;
}

function parseKind(value: string): DocKind {
  if (!DOC_KINDS.includes(value as DocKind)) {
    throw new InvalidArgumentError(`Choose one of: ${DOC_KINDS.join(", ")}.`);
  }
  return value as DocKind;
}

function intBetween(min: number, max: number) {
  return (value: string): number => {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new InvalidArgumentError(`Choose a whole number from ${min} to ${max}.`);
    }
    return n;
  };
}

async function readRequired(file: string): Promise<string> {
  const text = (await readFile(file, "utf8")).trim();
  if (!text) throw new Error(`${file} is empty.`);
  return text;
}

async function readOptional(file?: string): Promise<string | undefined> {
  return file ? (await readFile(file, "utf8")).trim() : undefined;
}

/** Reads multi-line answers from the terminal; an empty line ends an answer. */
function terminalIO(): IO & { close(): void } {
  const rl = readline.createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  return {
    say: (text) => console.log(text),
    async ask(prompt) {
      process.stdout.write(`${prompt}> `);
      const collected: string[] = [];
      for (;;) {
        const next = await lines.next();
        if (next.done) return collected.length ? collected.join("\n").trim() : null;
        if (next.value.trim() === "") return collected.join("\n").trim();
        collected.push(next.value);
      }
    },
    close: () => rl.close(),
  };
}

const TYPE_HELP = `interview type: ${INTERVIEW_TYPES.join(" | ")}`;

const program = new Command();

program
  .name("coach")
  .description("AI interview coach: mock interviews, voice practice, progress tracking, and a doc-to-deck pipeline.")
  .version("0.2.0");

program
  .command("mock")
  .description("Run an interactive mock interview with feedback after every answer")
  .option("-t, --type <type>", TYPE_HELP, parseType, "behavioral")
  .option("-j, --jd <file>", "job description, as a text or Markdown file")
  .option("-r, --resume <file>", "your resume, as a text or Markdown file")
  .option("-s, --stories <file>", "rehearse a story bank: every question targets one of its stories")
  .option("--story <text>", "with --stories, only rehearse stories matching this text")
  .option("-n, --questions <count>", "number of questions", intBetween(1, 15), 5)
  .option("--no-follow-ups", "skip the follow-up question after each answer")
  .option("-o, --out <dir>", "directory for saved sessions", "sessions")
  .action(async (opts) => {
    if (opts.story && !opts.stories) throw new Error("--story needs --stories <file>.");
    const llm = new AnthropicLLM();
    const io = terminalIO();
    try {
      const session = await runMock(
        llm,
        io,
        {
          type: opts.type,
          jobDescription: await readOptional(opts.jd),
          resume: await readOptional(opts.resume),
          stories: opts.stories ? await readRequired(opts.stories) : undefined,
          storyFocus: opts.story,
        },
        { count: opts.questions, followUps: opts.followUps },
      );
      if (session.rounds.length === 0) {
        console.log("\nNo answers recorded.");
        return;
      }
      const file = await saveSession(session, opts.out);
      console.log(`\nOverall: ${overallScore(session)}/5 across ${session.rounds.length} answers.`);
      console.log(`Transcript and feedback saved to ${file}`);
    } finally {
      io.close();
    }
  });

program
  .command("review")
  .description("Score one written answer or transcript from a file")
  .requiredOption("-q, --question <text>", "the interview question")
  .requiredOption("-a, --answer <file>", "file containing your answer or its transcript")
  .option("-t, --type <type>", TYPE_HELP, parseType, "behavioral")
  .option("-j, --jd <file>", "job description, as a text or Markdown file")
  .action(async (opts) => {
    const answer = await readRequired(opts.answer);
    const llm = new AnthropicLLM();
    const feedback = await evaluate(
      llm,
      { type: opts.type, jobDescription: await readOptional(opts.jd) },
      [{ question: opts.question, answer }],
    );
    console.log(renderFeedback(feedback, analyzeDelivery(answer, opts.type)));
  });

program
  .command("voice")
  .description("Practice a spoken answer: record or load audio, transcribe it, and analyze pacing")
  .requiredOption("-q, --question <text>", "the interview question you are answering")
  .option("-a, --audio <file>", "an existing recording (mp3, m4a, wav, webm...)")
  .option("--record", "record from your microphone with ffmpeg until you press Enter")
  .option("-t, --type <type>", TYPE_HELP, parseType, "behavioral")
  .option("-c, --competency <name>", "competency label used by `coach progress`", "general")
  .option("-j, --jd <file>", "job description, as a text or Markdown file")
  .option("--pacing-only", "transcribe and report pacing without scoring the content")
  .option("-o, --out <dir>", "directory for saved sessions", "sessions")
  .action(async (opts) => {
    if (Boolean(opts.audio) === Boolean(opts.record)) {
      throw new Error("Pass exactly one of --audio <file> or --record.");
    }
    const llm = opts.pacingOnly ? null : new AnthropicLLM();

    let audio: string = opts.audio;
    let tmp: string | undefined;
    try {
      if (opts.record) {
        tmp = await mkdtemp(path.join(tmpdir(), "coach-"));
        audio = path.join(tmp, "answer.wav");
        const rl = readline.createInterface({ input: process.stdin });
        console.log(`${opts.question}\n\nRecording. Press Enter when you finish your answer.`);
        try {
          await record(audio, new Promise<void>((resolve) => rl.once("line", () => resolve())));
        } finally {
          rl.close();
        }
      }

      console.log("Transcribing...");
      const transcript = await transcribe(audio);
      const pacing = analyzePacing(transcript, opts.type);
      const metrics = analyzeDelivery(transcript.text, opts.type);
      console.log(`\nTranscript:\n${transcript.text}\n`);

      if (!llm) {
        console.log(`Delivery: ${metrics.words} words in ${pacing.durationSeconds}s (${pacing.wordsPerMinute} wpm), ${metrics.fillerCount} filler words`);
        for (const n of pacing.notes) console.log(`  - ${n}`);
        return;
      }

      console.log("Evaluating...");
      const exchanges = [{ question: opts.question, answer: transcript.text }];
      const feedback = await evaluate(llm, { type: opts.type, jobDescription: await readOptional(opts.jd) }, exchanges);
      console.log(`\n${renderFeedback(feedback, metrics, pacing)}`);

      const session: Session = {
        type: opts.type,
        startedAt: new Date(),
        rounds: [{ competency: opts.competency, exchanges, feedback, metrics, pacing }],
      };
      console.log(`\nSaved to ${await saveSession(session, opts.out)}`);
    } finally {
      if (tmp) await rm(tmp, { recursive: true, force: true });
    }
  });

program
  .command("progress")
  .description("Show score trends across saved sessions, by competency and dimension")
  .option("-d, --dir <dir>", "directory of saved sessions", "sessions")
  .action(async (opts) => {
    console.log(renderProgress(summarize(await loadSessions(opts.dir))));
  });

program
  .command("stories")
  .description("Build a STAR story bank from your resume")
  .requiredOption("-r, --resume <file>", "your resume, as a text or Markdown file")
  .option("-j, --jd <file>", "job description to weight the stories toward")
  .option("-o, --out <file>", "where to write the story bank", "stories.md")
  .action(async (opts) => {
    const resume = await readRequired(opts.resume);
    const llm = new AnthropicLLM();
    console.log("Building your story bank...");
    const stories = await buildStories(llm, resume, await readOptional(opts.jd));
    await writeFile(opts.out, `${stories}\n`, "utf8");
    console.log(`Story bank written to ${opts.out}`);
  });

program
  .command("doc")
  .description("Turn rough notes or a project write-up into a reviewed technical document")
  .requiredOption("-i, --input <file>", "source notes or write-up")
  .option("-k, --kind <kind>", `document type: ${DOC_KINDS.join(" | ")}`, parseKind, "design-doc")
  .option("--audience <text>", "who will read it")
  .option("-o, --out <file>", "where to write the document", "doc.md")
  .action(async (opts) => {
    const source = await readRequired(opts.input);
    const llm = new AnthropicLLM();
    console.log("Drafting, reviewing, and revising...");
    const { doc, critique } = await writeDoc(llm, source, opts.kind, opts.audience);
    await writeFile(opts.out, `${doc}\n`, "utf8");
    const todos = (doc.match(/^.*TODO:.*$/gm) ?? []).length;
    console.log(`\nReviewer's notes on the first draft (addressed in the final version):\n${critique}\n`);
    console.log(`Document written to ${opts.out}${todos ? `, with ${todos} TODO line${todos === 1 ? "" : "s"} for details the source did not contain` : ""}.`);
  });

program
  .command("deck")
  .description("Turn a document into a slide storyline, written as Marp Markdown")
  .requiredOption("-i, --input <file>", "source document")
  .option("-n, --slides <count>", "number of content slides", intBetween(3, 30), 8)
  .option("-m, --minutes <count>", "length of the talk in minutes", intBetween(1, 120))
  .option("--audience <text>", "who you are presenting to")
  .option("-o, --out <file>", "where to write the deck", "deck.md")
  .action(async (opts) => {
    const source = await readRequired(opts.input);
    const llm = new AnthropicLLM();
    console.log("Planning the storyline...");
    const deck = await planDeck(llm, source, { slides: opts.slides, minutes: opts.minutes, audience: opts.audience });
    if (deck.slides.length === 0) throw new Error("The model returned no slides.");
    await writeFile(opts.out, renderDeck(deck), "utf8");
    console.log(`\n${deck.title}\n${renderStoryline(deck)}\n`);
    const issues = checkDeck(deck);
    if (issues.length) console.log(`Check before presenting:\n${issues.map((i) => `  - ${i}`).join("\n")}\n`);
    console.log(`Deck written to ${opts.out}`);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
