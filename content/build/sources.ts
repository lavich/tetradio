import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import type { LessonKind } from "../../src/content/course.ts";
import { LANGUAGES, PROFILES, type Language, type LanguageProfile } from "../../src/domain/language.ts";
import { fail, LANGUAGE, languageOf, parseYaml } from "./common.ts";
import { parseVoices, voicesFile, type VoiceMap } from "./voices.ts";

export interface WordSource {
  id?: string;
  greek: string;
  russian: string;
  ipa?: string;
  note?: string;
  forms?: string;
  paradigm?: { present?: string[]; past?: string[]; third?: boolean };
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
  /** Изучаемый язык, по умолчанию греческий. */
  language?: string;
  source?: string;
  /** Словарный курс перечисляет уроки; курс программы — модули, уроки берутся из них. */
  lessons?: string[];
  modules?: string[];
  exam?: unknown;
  passShare?: unknown;
  calendar?: unknown;
  level?: unknown;
  goal?: unknown;
  short?: unknown;
  order?: unknown;
}
/** Текст для беглого чтения: `readings/<курс>/<id>.yaml`; открывается после урока `after`. */
export interface ReadingSource {
  id?: string;
  title: string;
  after: string;
  series?: string;
  text: string;
  glosses?: { text: string; russian: string }[];
  names?: string[];
  /** Говорящий каждой строки диалога («—») по порядку; пустое имя — реплика без говорящего. */
  speakers?: string[];
  /** Герой, от лица которого рассказан текст: его голосом звучит повествование. */
  narrator?: string;
  provenance: { operation?: string; request?: string; review?: string };
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
 * в греческом слове. Глазами её не видно, а проверка ответа и синтез речи на ней ломаются. Проверяется письменность
 * курса вместе с кириллицей или с любой другой письменностью. IPA не проверяется: в транскрипции законно стоят θ, β, χ.
 */
const mixedPatterns = (profile: LanguageProfile) => {
  const own = profile.script.source;
  const other = `(?!${own})(?!\\p{Script=Cyrillic})(?!\\p{Script=Common})(?!\\p{Script=Inherited})\\p{L}`;
  return [
    new RegExp(`(?=\\S*${own})(?=\\S*\\p{Script=Cyrillic})\\S+`, "u"),
    new RegExp(`(?=\\S*${own})(?=\\S*${other})\\S+`, "u"),
  ];
};
const MIXED = Object.fromEntries(LANGUAGES.map((code) => [code, mixedPatterns(PROFILES[code])])) as Record<
  Language,
  RegExp[]
>;
function checkScripts(value: unknown, where: string, language: Language): void {
  if (typeof value === "string") {
    for (const pattern of MIXED[language]) {
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
  } else if (Array.isArray(value)) value.forEach((item, index) => checkScripts(item, `${where}[${index}]`, language));
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value))
      if (key !== "ipa" && key !== "file") checkScripts(item, `${where}.${key}`, language);
}
const idOf = (doc: { id?: unknown }, file: string) => {
  // id приходит из YAML нетипизированным: карта или список молча стали бы идентификатором «[object Object]».
  const raw = doc.id ?? basename(file, extname(file));
  if (typeof raw !== "string" && typeof raw !== "number") fail(`${file}: поле id — строка или число`);
  return String(raw).normalize("NFC");
};

export type Sourced<T> = T & { file: string };
/** Карточка принадлежит курсу своей папки; `file` — путь от `words/` или `phrases/` вместе с папкой курса. */
export type CourseCard<T> = Sourced<T> & { course: string };
export interface ContentRoot {
  words: Map<string, CourseCard<WordSource>>;
  phrases: Map<string, CourseCard<PhraseSource>>;
  lessons: Map<string, LessonSource>;
  readings: Map<string, CourseCard<ReadingSource>>;
  courses: Map<string, Sourced<CourseSource>>;
  modules: Map<string, Sourced<ModuleSource>>;
  /** Картинки слов из готовой библиотеки: `pictures.yaml` (слово → файл в pictures/) и подпись источника. */
  pictures: { source: string; words: Map<string, string> };
  files: Map<string, Uint8Array>;
  /** Голоса персонажей по языку курса; без карты записи реплик не публикуются, а говорящие не проверяются. */
  voices: Map<Language, VoiceMap>;
}
export function readSources(root: string): ContentRoot {
  const isYaml = (file: string) => /\.ya?ml$/.test(file);
  const list = (dir: string) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : []).filter(isYaml).sort();
  const load = <T>(dir: string, file: string) =>
    parseYaml(readFileSync(join(root, dir, file), "utf8"), `${dir}/${file}`) as T;
  const byId = <T extends { id?: unknown }>(dir: string) => {
    const map = new Map<string, Sourced<T>>();
    for (const file of list(dir)) {
      const doc = load<T>(dir, file);
      const id = idOf(doc, `${dir}/${file}`);
      const twin = map.get(id);
      if (twin) fail(`${dir}/${file}: идентификатор «${id}» уже занят файлом ${dir}/${twin.file}`);
      map.set(id, { ...doc, file });
    }
    return map;
  };
  const courses = byId<CourseSource>("courses"),
    modules = byId<ModuleSource>("modules");
  // Идентификатор уникален во всём контенте: прогресс в базе хранится по нему без курса.
  const cards = <T extends { id?: unknown }>(dir: string) => {
    const map = new Map<string, CourseCard<T>>();
    if (!existsSync(join(root, dir))) return map;
    const entries = readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        if (isYaml(entry.name))
          fail(`${dir}/${entry.name}: карточка вне курса — файл лежит в папке курса ${dir}/<курс>/`);
        continue;
      }
      const course = entry.name;
      if (!courses.has(course)) fail(`${dir}/${course}/: курса ${course} нет в courses/`);
      for (const name of list(join(dir, course))) {
        const file = `${course}/${name}`;
        const doc = load<T>(dir, file);
        const id = idOf(doc, `${dir}/${file}`);
        const twin = map.get(id);
        if (twin) fail(`${dir}/${file}: идентификатор «${id}» уже занят файлом ${dir}/${twin.file}`);
        map.set(id, { ...doc, file, course });
      }
    }
    return map;
  };
  const words = cards<WordSource>("words"),
    phrases = cards<PhraseSource>("phrases"),
    readings = cards<ReadingSource>("readings");
  const lessons = new Map<string, LessonSource>();
  const lessonFiles = new Map<string, string>();
  for (const file of list("lessons")) {
    const id = basename(file, extname(file));
    const twin = lessonFiles.get(id);
    if (twin) fail(`lessons/${file}: урок «${id}» уже есть в файле lessons/${twin}`);
    lessonFiles.set(id, file);
    lessons.set(id, load<LessonSource>("lessons", file));
  }
  const files = new Map<string, Uint8Array>();
  const picturesDoc = existsSync(join(root, "pictures.yaml"))
    ? (parseYaml(readFileSync(join(root, "pictures.yaml"), "utf8"), "pictures.yaml") as {
        source?: unknown;
        words?: unknown;
      })
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
  const voices = new Map<Language, VoiceMap>();
  for (const file of list("voices")) {
    const language = languageOf(basename(file, extname(file)), `voices/${file}`);
    const body = readFileSync(join(root, "voices", file), "utf8");
    parseYaml(body, `voices/${file}`);
    voices.set(language, parseVoices(body, voicesFile(language), language));
  }
  return { words, phrases, lessons, readings, courses, modules, pictures, files, voices };
}

export function checkSourceScripts(
  sources: ContentRoot,
  courses: Map<string, Language>,
  lessons: Map<string, Language>,
  modules: Map<string, Language>,
) {
  for (const src of sources.words.values()) checkScripts(src, `words/${src.file}`, courses.get(src.course) ?? LANGUAGE);
  for (const src of sources.phrases.values())
    checkScripts(src, `phrases/${src.file}`, courses.get(src.course) ?? LANGUAGE);
  for (const [id, src] of sources.modules) checkScripts(src, `modules/${src.file}`, modules.get(id) ?? LANGUAGE);
  for (const [id, src] of sources.lessons) checkScripts(src, `lessons/${id}.yaml`, lessons.get(id) ?? LANGUAGE);
}

const WORD_FIELDS = {
  id: true,
  greek: true,
  russian: true,
  ipa: true,
  note: true,
  forms: true,
  paradigm: true,
  verified: true,
  source: true,
  image: true,
  audio: true,
  reading: true,
  examples: true,
} satisfies Record<keyof WordSource, true>;
const PHRASE_FIELDS = {
  id: true,
  text: true,
  translation: true,
  usage: true,
  note: true,
  audio: true,
  provenance: true,
} satisfies Record<keyof PhraseSource, true>;
const LESSON_FIELDS = {
  title: true,
  language: true,
  words: true,
  items: true,
  kind: true,
  blocks: true,
} satisfies Record<keyof LessonSource, true>;
const MODULE_FIELDS = {
  id: true,
  number: true,
  title: true,
  subtitle: true,
  status: true,
  goal: true,
  grammar: true,
  sessions: true,
  lessons: true,
  checkpoint: true,
  review: true,
  crib: true,
} satisfies Record<keyof ModuleSource, true>;
const COURSE_FIELDS = {
  id: true,
  title: true,
  language: true,
  source: true,
  lessons: true,
  modules: true,
  exam: true,
  passShare: true,
  calendar: true,
  level: true,
  goal: true,
  short: true,
  order: true,
} satisfies Record<keyof CourseSource, true>;

const USER_OWNED =
  "поле не поставляется — статус занятия и дата урока принадлежат пользователю и задаются расписанием курса";
const LESSON_HINTS: Record<string, string> = { status: USER_OWNED, targetDate: USER_OWNED };

/** Поля, которые `readSources` дописывает сам: из YAML их быть не должно, но и отказом они не считаются. */
const FILE_ADDED = ["file"];
const CARD_ADDED = ["file", "course"];

function checkShape(
  doc: object,
  fields: Record<string, true>,
  lists: string[],
  where: string,
  hints: Record<string, string> = {},
  added: string[] = [],
) {
  const record = doc as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (added.includes(key)) continue;
    if (Object.hasOwn(hints, key)) fail(`${where}.${key}: ${hints[key]}`);
    if (!Object.hasOwn(fields, key)) fail(`${where}: лишнее поле ${key}`);
  }
  for (const key of lists)
    if (record[key] !== undefined && !Array.isArray(record[key])) fail(`${where}.${key}: ожидался список`);
}
function checkEntries(doc: object, key: string, where: string) {
  const list = (doc as Record<string, unknown>)[key];
  if (Array.isArray(list))
    list.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        fail(`${where}.${key}[${index}]: ожидалась карта полей`);
    });
}

/** Разбор файлов — в `readSources`: озвучка читает недописанные уроки, поэтому форма проверяется отдельно. */
export function checkSources(sources: ContentRoot) {
  for (const src of sources.words.values()) {
    const where = `words/${src.file}`;
    checkShape(src, WORD_FIELDS, ["reading", "examples"], where, {}, CARD_ADDED);
    checkEntries(src, "reading", where);
    checkEntries(src, "examples", where);
  }
  for (const src of sources.phrases.values()) checkShape(src, PHRASE_FIELDS, [], `phrases/${src.file}`, {}, CARD_ADDED);
  for (const [id, src] of sources.lessons) {
    const where = `lessons/${id}.yaml`;
    checkShape(src, LESSON_FIELDS, ["words", "items"], where, LESSON_HINTS);
    checkEntries(src, "items", where);
  }
  for (const src of sources.modules.values())
    checkShape(src, MODULE_FIELDS, ["grammar", "lessons", "review"], `modules/${src.file}`, {}, FILE_ADDED);
  for (const src of sources.courses.values())
    checkShape(src, COURSE_FIELDS, ["lessons", "modules"], `courses/${src.file}`, {}, FILE_ADDED);
}
