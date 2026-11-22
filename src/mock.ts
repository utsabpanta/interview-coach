import { evaluate, followUp, planQuestions, type Context, type Exchange } from "./coach.js";
import type { LLM } from "./llm.js";
import { analyzeDelivery } from "./metrics.js";
import { renderFeedback, type Session } from "./session.js";

/** Terminal I/O, abstracted so the interview loop can be tested. */
export interface IO {
  say(text: string): void;
  /** Returns the candidate's answer, or null when input has ended. */
  ask(prompt: string): Promise<string | null>;
}

export interface MockOptions {
  count: number;
  followUps: boolean;
}

const QUIT = "/quit";
const SKIP = "/skip";

export async function runMock(llm: LLM, io: IO, ctx: Context, opts: MockOptions): Promise<Session> {
  const session: Session = { type: ctx.type, startedAt: new Date(), rounds: [] };

  io.say(`Preparing a ${ctx.type} interview with ${opts.count} questions...`);
  const plan = await planQuestions(llm, ctx, opts.count);
  io.say(`Answer as you would out loud. Finish an answer with an empty line. ${SKIP} skips a question, ${QUIT} ends the interview.\n`);

  for (let i = 0; i < plan.length; i++) {
    const { question, competency } = plan[i];
    io.say(`\nQuestion ${i + 1} of ${plan.length}\n${question}\n`);

    const answer = await io.ask("You");
    if (answer === null || answer === QUIT) break;
    if (answer === SKIP || answer === "") continue;

    const exchanges: Exchange[] = [{ question, answer }];

    if (opts.followUps) {
      const probe = await followUp(llm, ctx, exchanges[0]);
      io.say(`\n${probe}\n`);
      const reply = await io.ask("You");
      if (reply !== null && reply !== "" && reply !== SKIP && reply !== QUIT) {
        exchanges.push({ question: probe, answer: reply });
      }
    }

    io.say("\nEvaluating...");
    const feedback = await evaluate(llm, ctx, exchanges);
    const metrics = analyzeDelivery(exchanges.map((e) => e.answer).join("\n"), ctx.type);
    session.rounds.push({ competency, exchanges, feedback, metrics });
    io.say(`\n${renderFeedback(feedback, metrics)}\n`);
  }

  return session;
}
