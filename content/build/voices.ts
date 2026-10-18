import { parse } from "yaml";
import { spokenText, synthText } from "../../src/domain/language.ts";
import { fail, hash } from "./common.ts";

export { spokenText, synthText };

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
  /** Слово (нижний регистр) → написание, с которым оно уходит в облачный синтез. */
  respell: Map<string, string>;
}
/** Что озвучено: файл реплики → голос и хэш (текст + голос) на момент синтеза. */
export type VoiceManifest = Record<string, { voice: string; hash: string }>;

export const lineHash = (text: string, voice: string, voices: Pick<VoiceMap, "language" | "respell">) =>
  hash(`${synthText(text, voices.language, voices.respell)}\n${voice}`, 16);
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
    respell: new Map(),
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
  const respell = raw!.respell;
  if (respell !== undefined) {
    if (!respell || typeof respell !== "object" || Array.isArray(respell))
      fail(`${at("respell")}: ожидалась карта «слово: написание»`);
    for (const [word, spelling] of Object.entries(respell as Record<string, unknown>)) {
      const key = word.normalize("NFC").toLowerCase();
      if (!/^\p{L}+$/u.test(key)) fail(`${at(`respell.${word}`)}: ключ — одно слово из букв`);
      if (typeof spelling !== "string" || !spelling.trim())
        fail(`${at(`respell.${word}`)}: написание для синтеза — непустая строка`);
      if (map.respell.has(key)) fail(`${at(`respell.${word}`)}: слово задано дважды (регистр не различается)`);
      map.respell.set(key, (spelling as string).normalize("NFC"));
    }
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

/** Уроки для синтеза: без аргументов — все, кроме черновых; названные явно озвучиваются при любом статусе. */
export function voiceableLessons(lessons: string[], drafts: Set<string>, wanted: string[]): string[] {
  return wanted.length ? wanted.filter((id) => lessons.includes(id)) : lessons.filter((id) => !drafts.has(id));
}

/** Файл реплики аудирования: `<урок>/<блок>-<n>.mp3`, не слово, фраза, текст или ответ. */
export const isLineFile = (file: string) =>
  /^(?!(?:words|phrases|readings|answers)\/)[^/]+\/[^/]+-\d+\.mp3$/.test(file);

/** Файлы на диске и в манифесте из области `owns`, которых нет среди запланированных. */
export const staleRecords = (
  planned: Set<string>,
  manifest: VoiceManifest,
  existing: string[],
  owns: (file: string) => boolean,
) => [...new Set([...existing, ...Object.keys(manifest)])].filter((file) => owns(file) && !planned.has(file)).sort();

const RETRY_ATTEMPTS = 5;
const RETRY_MAX_WAIT_MS = 30_000;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Повторяет запрос при сетевой ошибке, 429 и 5xx; после последней попытки возвращает ответ как есть. */
export async function retrying(
  send: () => Promise<Response>,
  sleep: (ms: number) => Promise<unknown> = pause,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let response: Response | undefined;
    let failure: unknown;
    try {
      response = await send();
    } catch (error) {
      failure = error;
    }
    const again = !response || response.status === 429 || response.status >= 500;
    if (!again || attempt === RETRY_ATTEMPTS) {
      if (response) return response;
      throw failure;
    }
    await response?.body?.cancel();
    const seconds = Number(response?.headers.get("retry-after"));
    await sleep(
      Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, RETRY_MAX_WAIT_MS) : 1000 * 2 ** (attempt - 1),
    );
  }
}

export const redactKey = (message: string, key: string | undefined) => (key ? message.replaceAll(key, "***") : message);

/** Ответ синтеза: прокси и 502 отдают HTML вместо JSON, поэтому тело разбирается без падения. */
export function parseReply(status: number, text: string, key: string | undefined) {
  let body: { audioContent?: string; error?: { message?: string } } = {};
  try {
    body = JSON.parse(text) ?? {};
  } catch {}
  const detail = body.error?.message ?? (body.audioContent ? "" : text.slice(0, 80));
  return { audio: body.audioContent, problem: `${status} ${redactKey(detail, key)}`.trim() };
}
