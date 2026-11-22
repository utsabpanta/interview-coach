import type { LLM, ToolSpec } from "./types.js";
import { countWords } from "./metrics.js";

/** Doc-to-deck pipeline: rough notes -> technical doc -> slide storyline. */

export const DOC_KINDS = ["design-doc", "readme", "runbook", "adr", "postmortem"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

const KIND_GUIDE: Record<DocKind, string> = {
  "design-doc":
    "A design doc: summary, context and problem, goals and non-goals, proposed design, alternatives considered with trade-offs, risks, rollout, open questions.",
  readme: "A README: what it is, why it exists, quick start, usage, configuration, development.",
  runbook: "A runbook: when to use it, prerequisites, numbered steps with exact commands, verification, rollback, escalation.",
  adr: "An architecture decision record: status, context, decision, options considered, consequences.",
  postmortem: "A blameless postmortem: summary, impact, timeline, root cause, what went well and badly, action items with owners.",
};

const WRITER = `You are a senior engineer who writes clear technical documents. Lead with the conclusion.
Prefer short sentences, concrete nouns, and exact numbers. Define terms on first use.
Use only facts present in the source material. Where the source lacks something the document
needs, do not invent it: write a line starting with "TODO:" that says exactly what is missing.`;

const CRITIC = `You are a skeptical staff engineer reviewing a document before it is circulated.
Find what would make a reader distrust or misread it: unsupported claims, undefined terms,
missing trade-offs, vague quantities, buried conclusions, and sections that say nothing.
Be specific and brief. Quote the phrase you mean.`;

export interface DocResult {
  doc: string;
  /** The reviewer's notes on the first draft, which the final doc addresses. */
  critique: string;
}

/** Draft, critique as a skeptical reviewer, then revise. */
export async function writeDoc(llm: LLM, source: string, kind: DocKind, audience?: string): Promise<DocResult> {
  const brief = `Document type: ${KIND_GUIDE[kind]}${audience ? `\nAudience: ${audience}` : ""}`;

  const draft = await llm.text(
    WRITER,
    `${brief}

<source>
${source}
</source>

Write the document in Markdown. Reply with the document only.`,
    8000,
  );

  const critique = await llm.text(
    CRITIC,
    `${brief}

<draft>
${draft}
</draft>

List up to 8 problems, most serious first, as a numbered list. For each: the problem, and the fix.`,
    1500,
  );

  const doc = await llm.text(
    WRITER,
    `${brief}

<source>
${source}
</source>

<draft>
${draft}
</draft>

<review>
${critique}
</review>

Revise the draft to address the review. Fix what the source material lets you fix; turn the rest
into TODO lines. Reply with the revised document only.`,
    8000,
  );

  return { doc, critique };
}

export interface Slide {
  /** A full-sentence takeaway, not a topic label. */
  title: string;
  points: string[];
  /** The one chart, diagram, or screenshot that proves the title. */
  visual?: string;
  notes: string;
}

export interface Deck {
  title: string;
  slides: Slide[];
}

export interface DeckOptions {
  slides: number;
  minutes?: number;
  audience?: string;
}

const PRESENTER = `You plan presentations for technical audiences. The story comes first: read in order,
the slide titles alone must make the whole argument. Every title is a full-sentence conclusion
("Caching cut p99 latency by 40%"), never a topic label ("Caching results"). One idea per slide.
Use only facts from the source; do not invent numbers.`;

const DECK_TOOL: ToolSpec = {
  name: "slide_storyline",
  description: "Record the deck's storyline.",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Deck title." },
      slides: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "The slide's conclusion as one sentence." },
            points: { type: "array", items: { type: "string" }, description: "At most 3 supporting points, each under 12 words." },
            visual: { type: "string", description: "The single visual that proves the title, or empty if none is needed." },
            notes: { type: "string", description: "What to say aloud, in 2 to 4 sentences." },
          },
          required: ["title", "points", "notes"],
        },
      },
    },
    required: ["title", "slides"],
  },
};

export async function planDeck(llm: LLM, source: string, opts: DeckOptions): Promise<Deck> {
  const user = `<source>
${source}
</source>

Plan a deck of exactly ${opts.slides} content slides${opts.minutes ? ` for a ${opts.minutes}-minute talk` : ""}${opts.audience ? `, for this audience: ${opts.audience}` : ""}.
Open with the main conclusion, then the evidence, then what you want from the audience.`;
  const deck = await llm.structured<Deck>(PRESENTER, user, DECK_TOOL, 4000);
  return { title: deck.title ?? "Untitled", slides: (deck.slides ?? []).slice(0, opts.slides) };
}

/** Local checks against the rules that keep slides sharp. Pure: no model call. */
export function checkDeck(deck: Deck): string[] {
  const issues: string[] = [];
  deck.slides.forEach((s, i) => {
    const n = `Slide ${i + 1}`;
    if (countWords(s.title) < 4) issues.push(`${n}: title "${s.title}" reads as a label; state the conclusion.`);
    if (s.points.length > 4) issues.push(`${n}: ${s.points.length} points; cut to 3.`);
    const long = s.points.filter((p) => countWords(p) > 15).length;
    if (long > 0) issues.push(`${n}: ${long} point${long === 1 ? "" : "s"} over 15 words.`);
    if (!s.notes?.trim()) issues.push(`${n}: no speaker notes.`);
  });
  return issues;
}

/** Renders the storyline as Marp-compatible Markdown, one slide per section. */
export function renderDeck(deck: Deck): string {
  const out: string[] = ["---", "marp: true", `title: ${JSON.stringify(deck.title)}`, "---", "", `# ${deck.title}`, ""];
  for (const s of deck.slides) {
    out.push("---", "", `## ${s.title}`, "");
    for (const p of s.points) out.push(`- ${p}`);
    if (s.points.length) out.push("");
    if (s.visual?.trim()) out.push(`> Visual: ${s.visual.trim()}`, "");
    if (s.notes?.trim()) out.push(`<!-- ${s.notes.trim().replace(/-->/g, "->")} -->`, "");
  }
  return out.join("\n");
}

/** The titles alone, to check that the story holds without the slides. */
export function renderStoryline(deck: Deck): string {
  return deck.slides.map((s, i) => `${String(i + 1).padStart(2)}. ${s.title}`).join("\n");
}
