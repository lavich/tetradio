import { spokenAnswer } from "../../src/domain/spoken.ts";
import type { LanguageProfile } from "../../src/domain/language.ts";
import { answerFile, lineHash, type VoiceManifest, type VoiceMap } from "./voices.ts";

export interface VoicedAnswer {
  blockId: string;
  itemId: string;
  text: string;
  file: string;
}

/** Озвучиваемые ответы урока по исходнику: общая для сборки и озвучки, чтобы тексты и файлы совпали. */
export function answerVoicing(lessonId: string, blocks: unknown, profile: LanguageProfile): VoicedAnswer[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap((block) => {
    const { type, id, format, items } = (block ?? {}) as Record<string, unknown>;
    if (type !== "exercise" || typeof id !== "string" || (format !== "text" && format !== "gap")) return [];
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
      const { id: itemId, prompt, answer } = (item ?? {}) as Record<string, unknown>;
      const first = Array.isArray(answer) ? answer[0] : answer;
      if (typeof itemId !== "string" || typeof prompt !== "string" || typeof first !== "string") return [];
      const text = spokenAnswer(format, prompt.normalize("NFC"), first.normalize("NFC"), profile);
      return text ? [{ blockId: id, itemId, text, file: answerFile(lessonId, id, itemId) }] : [];
    });
  });
}

/** Запись свежая, если сделана для нынешнего текста голосом диктора. */
export const answerFresh = (manifest: VoiceManifest, answer: VoicedAnswer, voices: VoiceMap) =>
  !!voices.narrator &&
  manifest[answer.file]?.voice === voices.narrator &&
  manifest[answer.file]?.hash === lineHash(answer.text, voices.narrator, voices.language);

type PlannedAnswer = VoicedAnswer & { label: string; voices: VoiceMap; voice: string };
export interface AnswerVoicePlan {
  answers: PlannedAnswer[];
  pending: PlannedAnswer[];
  /** Файлы `answers/…`, которым больше нет пункта. */
  stale: string[];
}
/** План озвучки ответов без сети; `existing` — файлы в `audio/answers`. */
export function planAnswerVoices(
  lessons: Iterable<[id: string, blocks: unknown]>,
  context: (lessonId: string) => { voices: VoiceMap | undefined; profile: LanguageProfile },
  manifest: VoiceManifest,
  existing: string[],
): AnswerVoicePlan {
  const answers: PlannedAnswer[] = [];
  const pending: PlannedAnswer[] = [];
  const skipped: string[] = [];
  for (const [lessonId, blocks] of lessons) {
    const { voices, profile } = context(lessonId);
    if (!voices?.narrator) {
      skipped.push(`answers/${lessonId}/`);
      continue;
    }
    for (const answer of answerVoicing(lessonId, blocks, profile)) {
      const entry = {
        ...answer,
        label: `${lessonId}/${answer.blockId}/${answer.itemId}`,
        voices,
        voice: voices.narrator,
      };
      answers.push(entry);
      if (!existing.includes(answer.file) || !answerFresh(manifest, answer, voices)) pending.push(entry);
    }
  }
  const planned = new Set(answers.map((answer) => answer.file));
  const recorded = Object.keys(manifest).filter((file) => file.startsWith("answers/"));
  const stale = [...new Set([...existing, ...recorded])]
    .filter((file) => !planned.has(file) && !skipped.some((dir) => file.startsWith(dir)))
    .sort();
  return { answers, pending, stale };
}
