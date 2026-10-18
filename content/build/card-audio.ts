import type { Language } from "../../src/domain/language.ts";
import { audioAssetId } from "./cards.ts";
import { fail, LANGUAGE } from "./common.ts";
import type { ContentRoot } from "./sources.ts";
import { lineHash, MANIFEST_FILE, parseManifest, voicesFile } from "./voices.ts";

export interface CardVoicing {
  voiced: number;
  /** Записи, сделанные до правки текста или смены диктора: не публикуются, карточка звучит синтезом устройства. */
  stale: string[];
  /** Подпись записи по id медиа: голос диктора. */
  sources: Map<string, string>;
}

/**
 * Слова и фразы читает диктор карты голосов; устаревшая запись снимается с карточки до сборки карточек.
 * Исходники не меняются: сборка дальше идёт по копии `sources` без устаревших записей.
 */
export function checkCardAudio(
  sources: ContentRoot,
  courseLanguages: Map<string, Language>,
): { voicing: CardVoicing; sources: ContentRoot } {
  const manifest = parseManifest(sources.files.get(MANIFEST_FILE));
  const voicing: CardVoicing = { voiced: 0, stale: [], sources: new Map() };
  const silenced = new Set<string>();
  const check = (where: string, id: string, src: { audio?: string; course: string }, text: unknown) => {
    if (src.audio === undefined) return;
    if (typeof src.audio !== "string") fail(`${where}.audio: ожидалось имя файла в audio/`);
    const language = courseLanguages.get(src.course) ?? LANGUAGE;
    const voices =
      sources.voices.get(language) ?? fail(`${where}.audio: запись требует карты голосов ${voicesFile(language)}`);
    const voice = voices.narrator ?? fail(`${where}.audio: запись читает диктор — narrator в ${voices.file}`);
    const done = manifest[src.audio];
    if (!done || done.voice !== voice || done.hash !== lineHash(String(text), voice, voices)) {
      voicing.stale.push(where);
      silenced.add(where);
      return;
    }
    voicing.sources.set(audioAssetId(id), voices.source.replaceAll("{voice}", voice));
    voicing.voiced++;
  };
  for (const [id, src] of sources.words) check(`words/${src.file}`, id, src, src.greek);
  for (const [id, src] of sources.phrases) check(`phrases/${src.file}`, id, src, src.text);
  const unvoiced = <T extends { audio?: string }>(map: Map<string, T>, dir: string) =>
    new Map(
      [...map].map(([id, src]) => {
        if (!silenced.has(`${dir}/${(src as { file?: string }).file}`)) return [id, src] as const;
        const { audio: _audio, ...rest } = src;
        return [id, rest as T] as const;
      }),
    );
  return {
    voicing,
    sources: { ...sources, words: unvoiced(sources.words, "words"), phrases: unvoiced(sources.phrases, "phrases") },
  };
}
