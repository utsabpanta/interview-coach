import { evaluate, interviewerTurn, planInterview, ROUND_SHAPE, type Context, type Exchange } from "./coach.js";
import { detectIntent } from "./intents.js";
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
const MAX_ASIDES = 3;

export const CONCERN_MESSAGE =
  "Let's pause here. It sounds like you may be going through something hard, and that matters more than interview practice. If you are thinking about harming yourself or you are in danger, please contact your local emergency number or a crisis line in your country now, or reach out to someone you trust.";
const SKIP = "/skip";

export async function runMock(llm: LLM, io: IO, ctx: Context, opts: MockOptions): Promise<Session> {
  const session: Session = { type: ctx.type, startedAt: new Date(), rounds: [] };

  io.say(
    ctx.stories
      ? `Preparing ${opts.count} ${ctx.type} questions to rehearse your story bank...`
      : `Preparing a ${ctx.type} interview with ${opts.count} questions...`,
  );
  const plan = await planInterview(llm, ctx, opts.count);
  io.say(
    `This is a conversation: the interviewer replies to what you say, and you can ask questions back. Finish each turn with an empty line. ${SKIP} moves on, ${QUIT} ends the interview.\n`,
  );
  if (plan.intro) io.say(`${plan.intro}\n`);

  const maxTurns = opts.followUps ? ROUND_SHAPE[ctx.type].turns : 1;
  let ended = false;

  for (let i = 0; i < plan.questions.length && !ended; i++) {
    const topic = plan.questions[i];
    io.say(`\nQuestion ${i + 1} of ${plan.questions.length}\n${topic.question}\n`);

    const exchanges: Exchange[] = [];
    let prompt = topic.question;
    let asides = 0;
    for (;;) {
      const answer = await io.ask("You");
      if (answer === null || answer === QUIT) {
        ended = true;
        break;
      }
      if (answer === SKIP || answer === "") break;

      if (detectIntent(answer) === "repeat") {
        io.say(`\n${prompt}\n`);
        continue;
      }
      exchanges.push({ question: prompt, answer });
      if (maxTurns === 1) break;

      const answered = exchanges.filter((e) => !e.aside).length;
      const next = await interviewerTurn(llm, ctx, topic, exchanges, maxTurns - answered);
      if (next.concern) {
        // Interview practice can wait. Say so, and stop without scoring.
        exchanges.pop();
        io.say(`\n${next.reply ? `${next.reply}\n\n` : ""}${CONCERN_MESSAGE}\n`);
        ended = true;
        break;
      }
      if (next.reply) io.say(`\n${next.reply}\n`);
      if (next.aside && asides < MAX_ASIDES) {
        // A request to rephrase or clarify does not use up one of the candidate's turns.
        exchanges[exchanges.length - 1].aside = true;
        asides++;
        prompt = next.reply;
        continue;
      }
      if (next.done) break;
      prompt = next.reply;
    }
    const answers = exchanges.filter((e) => !e.aside);
    if (answers.length === 0) continue;

    io.say("\nEvaluating...");
    const feedback = await evaluate(llm, ctx, exchanges, topic.story, undefined, topic);
    const metrics = analyzeDelivery(answers.map((e) => e.answer).join("\n"), ctx.type);
    session.rounds.push({ competency: topic.competency, story: topic.story, exchanges, feedback, metrics });
    // The target story is revealed only after the answer, so the rehearsal tests recall.
    io.say(`\n${topic.story ? `Target story: ${topic.story}\n` : ""}${renderFeedback(feedback, metrics)}\n`);
  }

  return session;
}
