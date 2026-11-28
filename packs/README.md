# Question packs

A pack tells the interviewer what good interviews for one kind of role actually probe. Packs are
written by people who know the role, and anyone can add one.

Choosing a pack does not replace the job posting: the interviewer still tailors every question to
the posting and the resume. The pack adds what an experienced interviewer for that role would look
for and the style of question they would ask.

## Add a pack

1. Copy an existing file in this directory and rename it to `your-pack-id.json`.
2. Fill in the fields below.
3. Run `npm test` at the repository root. A test checks every pack.
4. Open a pull request, and say in a sentence what experience the pack is based on.

| Field | What it is |
| --- | --- |
| `id` | Lowercase words joined by hyphens. Must match the file name. |
| `name` | What people see in the app, up to 60 characters. |
| `description` | One sentence on who it is for, up to 200 characters. |
| `types` | Which rounds it applies to: `behavioral`, `technical`, `system-design`. |
| `guidance` | 80 to 2,500 characters of plain prose: what to probe, what strong and weak answers look like. |
| `examples` | 3 to 12 questions that show the style. They are illustrations; the interviewer writes its own. |

## What makes a good pack

- **Write from experience.** Say what you would really ask and what you listen for.
- **Describe a kind of role, not a company.** Do not claim to reproduce a specific company's
  questions or process, and do not paste questions from paid courses or leaked lists.
- **Keep it current and practical.** Scenarios close to the real work beat trivia and puzzles.
- **Write guidance as guidance.** A pack is added to the interviewer's instructions, so it must
  only describe how to interview. Anything else will not be merged.
