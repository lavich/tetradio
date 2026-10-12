import { parse } from "yaml";
import { spokenText } from "../../src/domain/language.ts";
import { fail, hash } from "./common.ts";

export { spokenText };

/** Карта голосов своя у каждого языка: голоса синтеза у языков разные. */
export const voicesFile = (language: string) => `voices/${language}.yaml`;
export const MANIFEST_FILE = "audio/dialogues.json";
export type Gender = "female" | "male";

export interface VoiceMap {
  file: string;
  /** Источник записи реплики; `{voice}` заменяется именем голоса. */
  source: string;
  language: string;
  prefix: string;
  pools: Record<Gender, string[]>;
  narrator?: string;
  /** Чтец повествования текстов для чтения, если текст рассказан не от лица героя. */
  reader?: string;
  characters: Map<string, { gender: Gender; voice: string }>;
}
/** Что озвучено: файл реплики → голос и хэш (текст + голос) на момент синтеза. */
export type VoiceManifest = Record<string, { voice: string; hash: string }>;

export const lineHash = (text: string, voice: string, language: string) =>
  hash(`${spokenText(text, language)}\n${voice}`, 16);
export const lineFile = (lessonId: string, blockId: string, index: number) => `${lessonId}/${blockId}-${index + 1}.mp3`;
export const cardFile = (dir: "words" | "phrases", id: string) => `${dir}/${id}.mp3`;
export const answerFile = (lessonId: string, blockId: string, itemId: string) =>
  `answers/${lessonId}/${blockId}-${itemId}.mp3`;

const strings = (value: unknown, where: string): string[] => {
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== "string"))
    fail(`${where}: ожидался непустой список голосов`);
  return value as string[];
};

export function parseVoices(body: string, file: string, code?: string): VoiceMap {
  const raw = parse(body) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") fail(`${file}: ожидалась карта`);
  const at = (field: string) => `${file}.${field}`;
  const str = (field: string) => {
    const value = raw![field];
    if (typeof value !== "string" || !value.trim()) fail(`${at(field)}: поле обязательно`);
    return value as string;
  };
  const source = str("source");
  if (!source.includes("{voice}")) fail(`${at("source")}: в источнике нужно имя голоса — {voice}`);
  const pools = raw!.pools as Record<string, unknown> | undefined;
  const map: VoiceMap = {
    file,
    source,
    language: str("language"),
    prefix: str("prefix"),
    pools: { female: strings(pools?.female, at("pools.female")), male: strings(pools?.male, at("pools.male")) },
    characters: new Map(),
  };
  if (code && map.language !== code && !map.language.startsWith(`${code}-`))
    fail(`${at("language")}: ${map.language} — не язык файла (${code})`);
  if (!map.prefix.startsWith(map.language)) fail(`${at("prefix")}: голоса ${map.prefix} не языка ${map.language}`);
  const all = new Set([...map.pools.female, ...map.pools.male]);
  if (raw!.narrator !== undefined) {
    map.narrator = str("narrator");
    if (!all.has(map.narrator)) fail(`${at("narrator")}: голоса ${map.narrator} нет в pools`);
  }
  if (raw!.reader !== undefined) {
    map.reader = str("reader");
    if (!all.has(map.reader)) fail(`${at("reader")}: голоса ${map.reader} нет в pools`);
  }
  const characters = raw!.characters;
  if (!characters || typeof characters !== "object" || Array.isArray(characters))
    fail(`${at("characters")}: ожидалась карта «персонаж: { gender, voice }»`);
  for (const [name, entry] of Object.entries(characters as Record<string, unknown>)) {
    const where = at(`characters.${name}`);
    const { gender, voice, ...rest } = (entry ?? {}) as Record<string, unknown>;
    if (Object.keys(rest).length) fail(`${where}: лишнее поле «${Object.keys(rest)[0]}»`);
    if (gender !== "female" && gender !== "male") fail(`${where}.gender: female или male`);
    if (typeof voice !== "string" || !map.pools[gender as Gender].includes(voice))
      fail(`${where}.voice: голос ${String(voice)} не из пула ${String(gender)}`);
    map.characters.set(name.normalize("NFC"), { gender: gender as Gender, voice: voice as string });
  }
  return map;
}

export const voiceOf = (map: VoiceMap, speaker: string | undefined) =>
  speaker === undefined ? map.narrator : map.characters.get(speaker.normalize("NFC"))?.voice;

export function checkDialogueVoices(
  map: VoiceMap,
  lines: { speaker?: string }[],
  where: string,
): (string | undefined)[] {
  const owner = new Map<string, string>();
  return lines.map((line, index) => {
    const voice = voiceOf(map, line.speaker);
    const who = line.speaker ?? "диктор";
    if (!voice)
      fail(
        line.speaker === undefined
          ? `${where}.transcript[${index}]: у реплики без говорящего нужен голос диктора — narrator в ${map.file}`
          : `${where}.transcript[${index}]: у персонажа «${line.speaker}» нет голоса в ${map.file}`,
      );
    const other = owner.get(voice!);
    if (other !== undefined && other !== who)
      fail(`${where}: у «${other}» и «${who}» один голос ${voice} — в диалоге голоса должны различаться`);
    owner.set(voice!, who);
    return voice;
  });
}

/**
 * Голоса текста для чтения: повествование — рассказчика (герой `narrator` или чтец `reader` карты), строка диалога —
 * своего говорящего, пустое имя — рассказчика. Разные говорящие, включая рассказчика, звучат разными голосами.
 */
export function readingCast(
  map: VoiceMap,
  narrator: string | undefined,
  speakers: string[],
  where: string,
): { narration: string; lines: string[] } {
  const character = (name: string) => map.characters.get(name.normalize("NFC"))?.voice;
  const narration = narrator ? character(narrator) : map.reader;
  if (!narration)
    fail(
      narrator
        ? `${where}: у рассказчика «${narrator}» нет голоса в ${map.file}`
        : `${where}: нужен голос чтеца — reader в ${map.file} — или рассказчик narrator у текста`,
    );
  const reader = narrator ?? "чтец";
  const owner = new Map<string, string>([[narration!, reader]]);
  const lines = speakers.map((speaker, index) => {
    if (!speaker) return narration!;
    const voice = character(speaker);
    if (!voice) fail(`${where}: speakers[${index}]: у персонажа «${speaker}» нет голоса в ${map.file}`);
    const other = owner.get(voice!);
    if (other !== undefined && other !== speaker)
      fail(`${where}: у «${other}» и «${speaker}» один голос ${voice} — в тексте голоса должны различаться`);
    owner.set(voice!, speaker);
    return voice!;
  });
  return { narration: narration!, lines };
}
export const readingFile = (readingId: string, index: number) => `readings/${readingId}/${index + 1}.mp3`;

export function parseManifest(body: Uint8Array | undefined): VoiceManifest {
  if (!body) return {};
  try {
    return JSON.parse(Buffer.from(body).toString("utf8")) as VoiceManifest;
  } catch {
    return fail(`${MANIFEST_FILE}: не JSON`);
  }
}
