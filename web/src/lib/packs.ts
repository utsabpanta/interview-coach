import { validatePack, type InterviewType, type QuestionPack } from "../../../src/coach.js";

/**
 * Question packs from the repository's packs/ directory, bundled at build time.
 * Anything that does not pass validation is left out.
 */
const files = import.meta.glob("../../../packs/*.json", { eager: true, import: "default" });

export const PACKS: QuestionPack[] = Object.values(files)
  .filter((p): p is QuestionPack => validatePack(p).length === 0)
  .sort((a, b) => a.name.localeCompare(b.name));

export function packsFor(type: InterviewType): QuestionPack[] {
  return PACKS.filter((p) => p.types.includes(type));
}

export function findPack(id: string | undefined, type: InterviewType): QuestionPack | undefined {
  return packsFor(type).find((p) => p.id === id);
}
