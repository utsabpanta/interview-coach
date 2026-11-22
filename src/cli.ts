#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import readline from "node:readline";
import { Command, InvalidArgumentError } from "commander";
import { buildStories, evaluate, INTERVIEW_TYPES, type InterviewType } from "./coach.js";
import { AnthropicLLM } from "./llm.js";
import { analyzeDelivery } from "./metrics.js";
import { runMock, type IO } from "./mock.js";
import { overallScore, renderFeedback, saveSession } from "./session.js";

function parseType(value: string): InterviewType {
  if (!INTERVIEW_TYPES.includes(value as InterviewType)) {
    throw new InvalidArgumentError(`Choose one of: ${INTERVIEW_TYPES.join(", ")}.`);
  }
  return value as InterviewType;
}

function parseCount(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 15) {
    throw new InvalidArgumentError("Choose a whole number from 1 to 15.");
  }
  return n;
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

const program = new Command();

program
  .name("coach")
  .description("AI interview coach: mock interviews, scored feedback, and a story bank from your resume.")
  .version("0.1.0");

program
  .command("mock")
  .description("Run an interactive mock interview with feedback after every answer")
  .option("-t, --type <type>", `interview type: ${INTERVIEW_TYPES.join(" | ")}`, parseType, "behavioral")
  .option("-j, --jd <file>", "job description, as a text or Markdown file")
  .option("-r, --resume <file>", "your resume, as a text or Markdown file")
  .option("-n, --questions <count>", "number of questions", parseCount, 5)
  .option("--no-follow-ups", "skip the follow-up question after each answer")
  .option("-o, --out <dir>", "directory for the saved transcript", "sessions")
  .action(async (opts) => {
    const llm = new AnthropicLLM();
    const io = terminalIO();
    try {
      const session = await runMock(
        llm,
        io,
        { type: opts.type, jobDescription: await readOptional(opts.jd), resume: await readOptional(opts.resume) },
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
  .description("Score one answer, for example the transcript of a recorded video answer")
  .requiredOption("-q, --question <text>", "the interview question")
  .requiredOption("-a, --answer <file>", "file containing your answer or its transcript")
  .option("-t, --type <type>", `interview type: ${INTERVIEW_TYPES.join(" | ")}`, parseType, "behavioral")
  .option("-j, --jd <file>", "job description, as a text or Markdown file")
  .action(async (opts) => {
    const answer = (await readFile(opts.answer, "utf8")).trim();
    if (!answer) throw new Error(`${opts.answer} is empty.`);
    const llm = new AnthropicLLM();
    const feedback = await evaluate(
      llm,
      { type: opts.type, jobDescription: await readOptional(opts.jd) },
      [{ question: opts.question, answer }],
    );
    console.log(renderFeedback(feedback, analyzeDelivery(answer, opts.type)));
  });

program
  .command("stories")
  .description("Build a STAR story bank from your resume")
  .requiredOption("-r, --resume <file>", "your resume, as a text or Markdown file")
  .option("-j, --jd <file>", "job description to weight the stories toward")
  .option("-o, --out <file>", "where to write the story bank", "stories.md")
  .action(async (opts) => {
    const resume = (await readFile(opts.resume, "utf8")).trim();
    if (!resume) throw new Error(`${opts.resume} is empty.`);
    const llm = new AnthropicLLM();
    console.log("Building your story bank...");
    const stories = await buildStories(llm, resume, await readOptional(opts.jd));
    await writeFile(opts.out, `${stories}\n`, "utf8");
    console.log(`Story bank written to ${opts.out}`);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
