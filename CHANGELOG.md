# Changelog

Notable changes, newest first.

## Unreleased

### Added
- **On this device (experimental):** a model that runs in the browser, so no API key is needed.
- **Question packs:** community-written guidance for kinds of roles, with six starter packs.
- **Coaching points** attached to the exact words they are about, and a filler-word breakdown.
- **Notes pad** for technical and system design rounds, shared with the interviewer.
- **Natural voice** through Groq's text-to-speech, and automatic choice of the best browser voice.
- **Hands-free turn-taking**, with "I wasn't finished" to take a reply back.
- **Two-way conversation:** the interviewer answers clarifying questions, probes, and ends each
  round with the candidate's own questions.
- **Free and local model providers:** Groq, Google Gemini, OpenRouter, Ollama, and any
  OpenAI-compatible server.

### Changed
- The practice score counts first answers only, is withheld for rounds that were mostly skipped,
  and compares only with earlier sessions of the same kind.
- Questions follow current interview practice and are anchored to today's date.
- Fonts are bundled, and the built site ships a Content-Security-Policy.

### Fixed
- Answers were sent or discarded without the candidate meaning it: after pausing, after "Hear it
  again", when an answer resembled "repeat the question", and when a story ended like a sign-off.
- Voice stopped about a minute into an answer: when the browser ended a dictation session, a
  failed or interrupted restart silently stopped listening, or switched to typing for good.
- A free tier's per-minute limit ended the conversation; the app now waits and carries on.
- A crash left a blank page; it now shows what happened and how to report it.
- Unusable model output became a plausible score instead of an error.
- Quotes could be attributed to the candidate that they never said.

## 0.1.0

- The first web app: start, live interview, feedback with retry, and scorecard.
- The `coach` command-line tool.
