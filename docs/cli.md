# The `coach` command-line tool

The same coaching logic as the web app, in the terminal, plus voice-file analysis, a resume story
bank, and a doc-to-deck pipeline. Run the commands below from the repository root.

## What it does

| Command | Purpose |
| --- | --- |
| `coach mock` | An interactive mock interview. The interviewer asks a question, probes with one follow-up, then scores your answer and rewrites it. With `--stories`, it rehearses your story bank. |
| `coach voice` | Spoken practice. Records your answer (or loads a recording), transcribes it, and reports pace, pauses, and filler words alongside the content feedback. |
| `coach review` | Scores a single written answer or transcript from a file. |
| `coach progress` | Score trends across saved sessions, by competency and by scoring dimension. |
| `coach stories` | Reads your resume and writes a STAR story bank, with the details you still need to fill in and the questions each story answers. |
| `coach doc` | Turns rough notes into a technical document: draft, review by a skeptical critic, then revise. |
| `coach deck` | Turns a document into a slide storyline where every title states a conclusion, written as Marp Markdown. |

Each answer is scored from 1 to 5 on structure, specificity, relevance, and concision. Alongside the
model's feedback, the coach computes delivery metrics locally: word count, speaking time, filler
words, and whether you say "we" when you should say "I".

The coach is instructed never to invent facts. Rewrites use only what you said and mark missing
details with placeholders such as `[metric]`; documents mark gaps with `TODO:` lines.

## Setup

Requires Node.js 20 or later and an Anthropic API key.

```bash
npm install
npm run build
npm link            # optional: makes the `coach` command available everywhere

export ANTHROPIC_API_KEY=your-key
```

Without `npm link`, run commands as `npm run dev -- <command>`.

## Usage

### Mock interviews

```bash
# Behavioral mock interview, 5 questions, tailored to a role
coach mock --jd job.md --resume resume.md

# System design round, 2 questions, no follow-ups
coach mock --type system-design --questions 2 --no-follow-ups
```

Type your answer and finish it with an empty line. `/skip` skips a question and `/quit` ends the
interview early; answers given so far are still saved.

Interview types: `behavioral`, `technical`, `system-design`.

### Story bank and rehearsal

```bash
# Build the story bank, then fill in its "Fill in:" details by hand
coach stories --resume resume.md --jd job.md

# Rehearse: every question targets one of your stories
coach mock --stories stories.md

# Rehearse one story
coach mock --stories stories.md --story "migration" --questions 3
```

In rehearsal the target story is revealed only after you answer, and the feedback names prepared
details you left out.

### Voice practice

```bash
# Record from your microphone; press Enter to stop
coach voice --question "Tell me about a time you disagreed with your manager." --record

# Or analyze an existing recording
coach voice --question "Why this company?" --audio answer.m4a --competency influence

# Pace and pauses only, without content scoring (no Anthropic key needed)
coach voice --question "..." --audio answer.m4a --pacing-only
```

Claude's API does not accept audio, so transcription uses an OpenAI-compatible speech-to-text
endpoint: OpenAI's Whisper API by default (`OPENAI_API_KEY`), or any compatible server such as a
local Whisper server (`COACH_TRANSCRIBE_URL`). Recording needs [ffmpeg](https://ffmpeg.org) and is
preconfigured for macOS and Linux; elsewhere, set `COACH_FFMPEG_INPUT` or use `--audio`.

Pace is measured from the recording's real length; 120 to 170 words per minute is the target.
Pauses of 2 seconds or more between transcript segments are counted. Transcription models often
drop "um" and "uh", so filler counts from audio are a lower bound.

### Progress

```bash
coach progress
```

```
3 answers across 2 sessions

Sessions
  2026-11-01  behavioral      2 answers  3.0/5
  2026-11-08  behavioral      1 answers  3.5/5

By competency (weakest first)
  conflict       2.8/5   2 answers  up 1.5
  failure        4.0/5   1 answers

By dimension
  structure      3.3/5
  specificity    2.7/5  <- work on this
  relevance      3.3/5
  concision      3.3/5

Filler words: 0 per 100 words on average
```

Mock and voice sessions are saved to `sessions/` as a readable Markdown transcript plus a JSON
record, which is what `progress` reads. Mock questions use a fixed set of competency labels per
interview type so that scores line up across sessions.

### Doc-to-deck pipeline

```bash
# Rough notes -> reviewed design doc
coach doc --input notes.md --kind design-doc --audience "platform team" --out design.md

# Doc -> 8-slide storyline for a 10-minute talk
coach deck --input design.md --slides 8 --minutes 10 --out deck.md
```

Document kinds: `design-doc`, `readme`, `runbook`, `adr`, `postmortem`.

`coach doc` prints the reviewer's notes on the first draft and writes the revised document.
`coach deck` prints the slide titles on their own, so you can check that the story holds, and
flags slides that break the rules: titles that are labels rather than conclusions, more than four
points, points over 15 words, and missing speaker notes. The output is
[Marp](https://marp.app) Markdown, with speaker notes as comments; render it with
`npx @marp-team/marp-cli deck.md --pptx` or `--pdf`.

This doubles as interview prep: write up a project, turn it into a doc and a five-minute deck, then
practice presenting it with `coach voice`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | Required for everything except `progress` and `voice --pacing-only`. |
| `COACH_MODEL` | `claude-sonnet-5-5` | Which Claude model to use. |
| `OPENAI_API_KEY` | none | For `voice`, when using OpenAI's transcription API. |
| `COACH_TRANSCRIBE_URL` | OpenAI's endpoint | Any OpenAI-compatible `/audio/transcriptions` endpoint. |
| `COACH_TRANSCRIBE_MODEL` | `whisper-1` | Transcription model name sent to that endpoint. |
| `COACH_FFMPEG_INPUT` | per platform | ffmpeg input arguments for the microphone, for example `-f pulse -i default`. |

Sessions (`sessions/`) and `stories.md` are in `.gitignore` because they contain personal material.
