# interview-coach

An AI interview coach for the terminal. It runs mock interviews tailored to a job description and
your resume, scores every answer, and builds a bank of reusable stories from your experience.

Built with TypeScript and the Claude API.

## What it does

| Command | Purpose |
| --- | --- |
| `coach mock` | An interactive mock interview. The interviewer asks a question, probes with one follow-up, then scores your answer and rewrites it. The transcript is saved as Markdown. |
| `coach review` | Scores a single answer from a file. Use it on the transcript of a recorded video answer. |
| `coach stories` | Reads your resume and writes a STAR story bank, with the details you still need to fill in and the questions each story answers. |

Each answer is scored from 1 to 5 on structure, specificity, relevance, and concision. Alongside the
model's feedback, the coach computes delivery metrics locally: word count, estimated speaking time,
filler words, and whether you say "we" when you should say "I".

The coach is instructed never to invent facts about you. Rewrites use only what you said and mark
missing details with placeholders such as `[metric]`.

## Setup

Requires Node.js 20 or later and an Anthropic API key.

```bash
git clone https://github.com/utsabpanta/interview-coach.git
cd interview-coach
npm install
npm run build
npm link            # optional: makes the `coach` command available everywhere

export ANTHROPIC_API_KEY=your-key
```

Without `npm link`, run commands as `npm run dev -- <command>`.

## Usage

```bash
# Behavioral mock interview, 5 questions, tailored to a role
coach mock --jd job.md --resume resume.md

# System design round, 2 questions, no follow-ups
coach mock --type system-design --questions 2 --no-follow-ups

# Score one answer, such as a transcript of a practice video
coach review --question "Tell me about a time you disagreed with your manager." --answer answer.txt

# Build a story bank
coach stories --resume resume.md --jd job.md
```

During a mock interview, type your answer and finish it with an empty line. `/skip` skips a
question and `/quit` ends the interview early; answers given so far are still saved.

Interview types: `behavioral`, `technical`, `system-design`.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | Required. |
| `COACH_MODEL` | `claude-sonnet-5-5` | Which Claude model to use. |

Transcripts (`sessions/`) and `stories.md` are in `.gitignore` because they contain personal material.

## Development

```bash
npm test            # unit tests; no API key needed
npm run typecheck
```

```
src/
  cli.ts       commands and terminal input
  mock.ts      the interview loop
  coach.ts     prompts: plan questions, follow up, evaluate, build stories
  metrics.ts   local delivery metrics (no model call)
  session.ts   transcript rendering and saving
  llm.ts       thin Claude API wrapper behind an interface, so tests use a fake
```

## Roadmap

- Voice practice: record an answer, transcribe it, and analyze pacing.
- Progress tracking across sessions, by competency.
- Draw mock questions from the story bank to rehearse specific stories.
- Doc-to-deck pipeline: turn a project write-up into a technical doc and a slide storyline.
