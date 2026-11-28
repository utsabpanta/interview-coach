# Security

## Reporting a problem

Please do not open a public issue for a security problem. Use GitHub's private reporting instead:
on the repository page, go to **Security**, then **Report a vulnerability**. Describe what you
found and how to reproduce it. You should hear back within a week.

## What is in scope

Callback is a static web app with no backend. The things worth protecting are the API keys a
visitor types in and the content of their practice sessions. Reports about any of the following
are especially welcome:

- A way for page content, model output, a job posting, a resume, or a question pack to run script
  in the page or read stored API keys.
- A key being sent anywhere other than the provider it belongs to.
- Practice content being stored or sent somewhere the README's Privacy section does not describe.
- A weakness in the Content-Security-Policy that the built site ships with.

## Known limits

- API keys are stored in the browser. Browser storage is shared by every page at the same web
  address, so hosting Callback under a path of a larger site exposes keys to that site's other
  pages. Host it on its own origin where you can.
- The job posting, resume, and answers are sent to whichever model provider the visitor chooses.
- Question packs are added to the interviewer's instructions. They are reviewed before merging,
  but treat a build from an untrusted fork as untrusted.
