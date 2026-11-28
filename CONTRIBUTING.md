# Contributing to Callback

Thanks for helping. This guide covers setup, where things live, and what a good change looks like.

## Setup

Requires Node.js 20 or later.

```bash
git clone https://github.com/utsabpanta/interview-coach.git
cd interview-coach
npm install            # shared logic and the CLI
cd web && npm install  # the web app
npm run dev
```

Open the dev server with `?mock=1` (for example `http://localhost:5173/?mock=1`) to click through
the whole app without an API key. This uses scripted sample data from `web/src/lib/mockLlm.ts`.

## Before you send a change

Run both test suites and both builds. The same commands run in CI.

```bash
# repository root
npm run typecheck && npm test && npm run build

# web/
npm test && npm run build
```

## Where things live

| Path | What it holds |
| --- | --- |
| `src/coach.ts` | The prompts: planning questions, the interviewer's replies, and scoring. Most improvements to interview quality happen here. |
| `src/openai.ts` | The client for OpenAI-compatible model providers. |
| `src/metrics.ts`, `src/pacing.ts` | Delivery metrics computed without a model. |
| `web/src/screens/` | The four screens: start, interview, feedback, scorecard. |
| `web/src/lib/providers.ts` | Model provider presets. |
| `web/src/lib/localLlm.ts` | The experimental model that runs in the browser. |
| `packs/` | Community question packs, validated by `test/packs.test.ts`. |
| `web/src/lib/speech.ts` | Speech recognition, read-aloud, and the voice meter. |
| `src/cli.ts` and friends | The command-line tool, documented in `docs/cli.md`. |

## Good first contributions

- **A question pack for a role you interview for.** This is the easiest way to help and needs no
  code: add one JSON file. See [packs/README.md](packs/README.md).
- **Interview guidance for a role you know.** If the questions for your field feel generic, improve
  the guidance in `src/coach.ts` and say in the pull request what changed in practice.
- **A model provider preset.** Add it to `web/src/lib/providers.ts` and confirm it accepts
  requests from a browser.
- **Browser fixes.** Speech features differ across browsers; reports and fixes with the browser
  and version named are valuable.

## Guidelines

- **Keep the app serverless.** Callback's promise is no signup and no backend. Features that need
  a server should be optional and discussed in an issue first.
- **Never invent facts about the candidate.** Prompts must keep rewrites to what the person said,
  with bracketed placeholders for gaps.
- **Do not trust model output.** Smaller models ignore schemas; coerce and validate what comes
  back, as `normalizeFeedback` and `normalizePlan` do.
- **Test what you can without a model.** Prompts are tested by checking what is sent and how
  replies are handled, using fakes. Add a test with any logic change.
- **Be honest in the UI.** Do not show controls for features that are not built, and do not make
  privacy claims the code cannot keep.

## Reporting a problem

Open an issue with the browser, the model provider and model name, the interview type, and what
you expected. For poor questions or feedback, paste an example; that is the fastest way to get the
guidance improved. Remove anything private first.

For security problems, do not open a public issue; see [SECURITY.md](SECURITY.md). Everyone taking
part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
