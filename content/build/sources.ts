import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import { parse } from "yaml";
import type { LessonKind } from "../../src/content/course.ts";
import { fail } from "./common.ts";
import { parseVoices, VOICES_FILE, type VoiceMap } from "./voices.ts";

export interface WordSource {
  id?: string;
  greek: string;
  russian: string;
  ipa?: string;
  note?: string;
  forms?: string;
  verified?: boolean;
  source?: string;
  image?: string;
  audio?: string;
  reading?: { text: string; ipa: string; explanation: string }[];
  examples?: {
    greek: string;
    russian: string;
    target: string;
    source?: string;
    words?: { text: string; russian: string; word?: string }[];
  }[];
}
export interface PhraseSource {
  id?: string;
  text: string;
  translation?: string;
  usage?: string;
  note?: string;
  audio?: string;
  provenance: unknown;
}
export interface LessonItemSource {
  kind: string;
  id: string;
}
export interface LessonSource {
  title: string;
  language?: string;
  words?: string[];
  items?: LessonItemSource[];
  /** Урок курса: вид и блоки; у аудирования `audio` — файл в audio/. */
  kind?: LessonKind;
  blocks?: unknown[];
}
export interface CourseSource {
  id?: string;
  title: string;
  source?: string;
  /** Словарный курс перечисляет уроки; курс программы — модули, уроки берутся из них. */
  lessons?: string[];
  modules?: string[];
  exam?: unknown;
}
/** Модуль программы: `modules/NN.yaml`; уроки черновика собираются для проверки, но не поставляются. */
export interface ModuleSource {
  id?: string;
  number: number;
  title: string;
  subtitle: string;
  status: "draft" | "published";
  goal: string;
  grammar?: string[];
  sessions: number;
  lessons?: string[];
  /** Контрольная точка после модуля: урок `kind: test`, не входящий в `lessons`. */
  checkpoint?: string;
  /** Уроки после контрольной точки (`kind: lesson`). */
  review?: string[];
  crib?: unknown;
}

/**
 * Слово из букв двух алфавитов — почти всегда опечатка раскладки: греческая «α» в русском «аор.», латинская «o»
 * в греческом слове. Глазами её не видно, а проверка ответа и синтез речи на ней ломаются. IPA не проверяется:
 * в транскрипции законно стоят θ, β, χ.
 */
const MIXED = [/(?=\S*\p{Script=Greek})(?=\S*\p{Script=Cyrillic})\S+/u, /(?=\S*\p{Script=Greek})(?=\S*[A-Za-z])\S+/u];
function checkScripts(value: unknown, where: string): void {
  if (typeof value === "string") {
    for (const pattern of MIXED) {
      const hit = value.match(pattern);
      // Исключения: подсказки произношения в квадратных скобках ([аθи́на] — θ вместо звука, которого нет в русском),
      // имена файлов, ссылки и уровни вроде Α2.
      if (
        hit &&
        !/^(?:[A-Za-z]*\d|Α\d)/u.test(hit[0]) &&
        !/^https?:/.test(hit[0]) &&
        !hit[0].includes("[") &&
        !hit[0].includes("/") &&
        !/\.(?:svg|png|webp|jpe?g|mp3|ogg|m4a|wav|yaml)\b/.test(hit[0])
      )
        fail(`${where}: в слове «${hit[0]}» смешаны алфавиты — проверьте раскладку`);
    }
  } else if (Array.isArray(value)) value.forEach((item, index) => checkScripts(item, `${where}[${index}]`));
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value))
      if (key !== "ipa" && key !== "file") checkScripts(item, `${where}.${key}`);
}
const idOf = (doc: { id?: unknown }, file: string) => {
  // id приходит из YAML нетипизированным: карта или список молча стали бы идентификатором «[object Object]».
  const raw = doc.id ?? basename(file, extname(file));
  if (typeof raw !== "string" && typeof raw !== "number") fail(`${file}: поле id — строка или число`);
  return String(raw).normalize("NFC");
};

export type Sourced<T> = T & { file: string };
export interface ContentRoot {
  words: Map<string, Sourced<WordSource>>;
  phrases: Map<string, Sourced<PhraseSource>>;
  lessons: Map<string, LessonSource>;
  courses: Map<string, Sourced<CourseSource>>;
  modules: Map<string, Sourced<ModuleSource>>;
  /** Картинки слов из готовой библиотеки: `pictures.yaml` (слово → файл в pictures/) и подпись источника. */
  pictures: { source: string; words: Map<string, string> };
  files: Map<string, Uint8Array>;
  /** Голоса персонажей; без карты записи реплик не публикуются, а говорящие не проверяются. */
  voices?: VoiceMap;
}
export function readSources(root: string): ContentRoot {
  const list = (dir: string) =>
    (existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : []).filter((file) => /\.ya?ml$/.test(file)).sort();
  const load = <T>(dir: string, file: string) => parse(readFileSync(join(root, dir, file), "utf8")) as T;
  const byId = <T extends { id?: unknown }>(dir: string) => {
    const map = new Map<string, Sourced<T>>();
    for (const file of list(dir)) {
      const doc = load<T>(dir, file);
      const id = idOf(doc, file);
      const twin = map.get(id);
      if (twin) fail(`${dir}/${file}: идентификатор «${id}» уже занят файлом ${dir}/${twin.file}`);
      map.set(id, { ...doc, file });
    }
    return map;
  };
  const words = byId<WordSource>("words"),
    phrases = byId<PhraseSource>("phrases"),
    courses = byId<CourseSource>("courses"),
    modules = byId<ModuleSource>("modules");
  const lessons = new Map(
    list("lessons").map((file) => [basename(file, extname(file)), load<LessonSource>("lessons", file)]),
  );
  const files = new Map<string, Uint8Array>();
  const picturesDoc = existsSync(join(root, "pictures.yaml"))
    ? (parse(readFileSync(join(root, "pictures.yaml"), "utf8")) as { source?: unknown; words?: unknown })
    : null;
  if (picturesDoc && (typeof picturesDoc.source !== "string" || !picturesDoc.source.trim()))
    fail("pictures.yaml: нужен source — библиотека и лицензия картинок");
  if (picturesDoc?.words !== undefined && (typeof picturesDoc.words !== "object" || Array.isArray(picturesDoc.words)))
    fail("pictures.yaml.words: ожидалась карта «слово: файл»");
  const pictures = {
    source: (picturesDoc?.source as string | undefined) ?? "",
    words: new Map(
      Object.entries((picturesDoc?.words ?? {}) as Record<string, unknown>).map(([id, file]) => [id, String(file)]),
    ),
  };
  for (const dir of ["art", "audio", "pictures"])
    if (existsSync(join(root, dir)))
      for (const entry of readdirSync(join(root, dir), { recursive: true, withFileTypes: true }))
        if (entry.isFile()) {
          const path = relative(root, join(entry.parentPath, entry.name)).split(sep).join("/");
          files.set(path, readFileSync(join(root, path)));
        }
  const voices = existsSync(join(root, VOICES_FILE))
    ? parseVoices(readFileSync(join(root, VOICES_FILE), "utf8"))
    : undefined;
  return { words, phrases, lessons, courses, modules, pictures, files, ...(voices ? { voices } : {}) };
}

export function checkSourceScripts(sources: ContentRoot) {
  for (const [dir, map] of [
    ["words", sources.words],
    ["phrases", sources.phrases],
    ["modules", sources.modules],
  ] as const)
    for (const [, src] of map as Map<string, { file: string }>) checkScripts(src, `${dir}/${src.file}`);
  for (const [id, src] of sources.lessons) checkScripts(src, `lessons/${id}.yaml`);
}
