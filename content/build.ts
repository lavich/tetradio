import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { wordKey } from "../src/domain/import.ts";
import { phraseKey } from "../src/domain/refs.ts";
import {
  ContentError,
  PHRASE_FIELDS,
  SCHEMA_VERSION,
  SHIPPED_FIELDS,
  validatePhrase,
  type Catalog,
  type CatalogCourse,
  type CatalogEntry,
  type ContentPackage,
  type PackageItem,
  type PackageMedia,
  type PackagePhrase,
  type PackageWord,
} from "../src/content/schema.ts";
import { CARD_KINDS, type CardKind, type Example, type Gloss, type Segment } from "../src/domain/types.ts";
import { checkArt, LEGACY_FILE, readLegacy, type ArtReport } from "./art.ts";

/**
 * Публикация контента. Исходники — YAML: одно слово — один файл в `words/` с греческим именем, фраза — файл
 * в `phrases/`, урок — упорядоченный список карточек в `lessons/`
 * (`words` для словарного урока либо `items` из пар `{kind, id}` для смешанного), иллюстрации и аудио —
 * отдельные файлы в `art/` и `audio/`. Идентификатор карточки — поле `id`, а без него — имя файла; у исходных
 * слов сохранены прежние `w11-01`, чтобы прогресс и миграция пользователей не зависели от переименования файлов.
 * Генератор собирает каталог, неизменяемые пакеты уроков и медиа; клиент исходники не читает.
 */
export const LANGUAGE = "el";
export const ART_SOURCE = "Собственная векторная иллюстрация Lexi (CC0)";
export const imageAssetId = (wordId: string) => `img-${wordId}`;
export const audioAssetId = (wordId: string) => `snd-${wordId}`;
const MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
};

export interface WordSource {
  id?: string;
  greek: string;
  russian: string;
  ipa?: string;
  note?: string;
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
}
export interface CourseSource {
  id?: string;
  title: string;
  source?: string;
  lessons: string[];
}

const hash = (value: string | Uint8Array, length = 12) =>
  createHash("sha256").update(value).digest("hex").slice(0, length);
/** Ключи в фиксированном порядке: одинаковое содержимое даёт одинаковую ревизию. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const pick = <T extends object>(value: T, fields: readonly (keyof T)[]) =>
  Object.fromEntries(fields.map((field) => [field, value[field]]));
export const revisionOf = (word: Omit<PackageWord, "revision">) => hash(canonical(pick(word, SHIPPED_FIELDS)));
export const phraseRevisionOf = (phrase: Omit<PackagePhrase, "revision">) =>
  hash(canonical(pick(phrase, PHRASE_FIELDS)));

const fail: (message: string) => never = (message) => {
  throw new ContentError(message);
};
const text = (value: unknown, where: string, required = true): string | undefined => {
  if (value === undefined || value === null) {
    if (required) fail(`${where}: поле обязательно`);
    return undefined;
  }
  if (typeof value !== "string") fail(`${where}: ожидалась строка`);
  return (value as string).normalize("NFC");
};
/** Все строки объекта приводятся к NFC, чтобы ревизия и сравнение не зависели от формы записи в редакторе. */
const nfc = (value: unknown): unknown =>
  typeof value === "string"
    ? value.normalize("NFC")
    : Array.isArray(value)
      ? value.map(nfc)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, nfc(v)]))
        : value;
const idOf = (doc: { id?: unknown }, file: string) => {
  // id приходит из YAML нетипизированным: карта или список молча стали бы идентификатором «[object Object]».
  const raw = doc.id ?? basename(file, extname(file));
  if (typeof raw !== "string" && typeof raw !== "number") fail(`${file}: поле id — строка или число`);
  return String(raw).normalize("NFC");
};
const checkId = (id: string, where: string) => {
  if (!/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(id))
    fail(`${where}: идентификатор «${id}» — буквы, цифры и дефис без пробелов`);
};

type Sourced<T> = T & { file: string };
export interface ContentRoot {
  words: Map<string, Sourced<WordSource>>;
  phrases: Map<string, Sourced<PhraseSource>>;
  lessons: Map<string, LessonSource>;
  courses: Map<string, Sourced<CourseSource>>;
  files: Map<string, Uint8Array>;
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
    courses = byId<CourseSource>("courses");
  const lessons = new Map(
    list("lessons").map((file) => [basename(file, extname(file)), load<LessonSource>("lessons", file)]),
  );
  const files = new Map<string, Uint8Array>();
  for (const dir of ["art", "audio"])
    if (existsSync(join(root, dir)))
      for (const file of readdirSync(join(root, dir))) files.set(`${dir}/${file}`, readFileSync(join(root, dir, file)));
  return { words, phrases, lessons, courses, files };
}

export interface BuiltFile {
  path: string;
  body: string | Uint8Array;
  mimeType: string;
}
export interface BuiltContent {
  catalog: Catalog;
  packages: ContentPackage[];
  files: BuiltFile[];
  words: PackageWord[];
  phrases: PackagePhrase[];
  sources: ContentRoot;
  art: ArtReport;
}

/**
 * Автор перечисляет размечаемые отрезки в порядке предложения; каждый ищется после предыдущего, поэтому
 * повтор слова находит следующее вхождение, а пересечение или обратный порядок дают «не найден».
 */
function glossesOf(words: unknown, greek: string, where: string): Gloss[] {
  if (!Array.isArray(words)) fail(`${where}: ожидался список отрезков`);
  let end = 0;
  return (words as unknown[]).map((entry, index): Gloss => {
    const path = `${where}[${index}]`;
    if (typeof entry !== "object" || entry === null) fail(`${path}: ожидался отрезок {text, russian}`);
    const src = entry as { text?: unknown; russian?: unknown; word?: unknown };
    const part = text(src.text, `${path}.text`)!;
    const russian = text(src.russian, `${path}.russian`)!;
    if (!part.trim()) fail(`${path}: пустой отрезок`);
    if (!russian.trim()) fail(`${path}: у отрезка «${part}» нет перевода`);
    const start = greek.indexOf(part, end);
    if (start < 0)
      fail(
        greek.includes(part)
          ? `${path}: отрезок «${part}» пересекается с предыдущим или стоит не по порядку предложения`
          : `${path}: отрезок «${part}» не найден в предложении «${greek}»`,
      );
    end = start + part.length;
    const gloss: Gloss = { start, length: part.length, russian };
    const wordId = text(src.word, `${path}.word`, false);
    if (wordId) gloss.wordId = wordId;
    return gloss;
  });
}

function describe(id: string, src: Sourced<WordSource>): PackageWord {
  const where = `words/${src.file}`;
  checkId(id, where);
  const greek = text(src.greek, `${where}.greek`)!,
    russian = text(src.russian, `${where}.russian`)!;
  if (!/[Ͱ-Ͽἀ-῿]/u.test(greek)) fail(`${where}: в греческом написании нет греческих букв`);
  const segments = (src.reading ?? []).map((note, index): Segment => {
    const path = `${where}.reading[${index}]`;
    const segment = {
      text: text(note.text, `${path}.text`)!,
      ipa: text(note.ipa, `${path}.ipa`)!,
      explanation: text(note.explanation, `${path}.explanation`)!,
      start: greek.indexOf(note.text.normalize("NFC")),
    };
    if (segment.start < 0) fail(`${path}: сочетание «${segment.text}» не найдено в слове «${greek}»`);
    return segment;
  });
  const source = text(src.source, `${where}.source`, false);
  const examples = (src.examples ?? []).map((example, index): Example => {
    const path = `${where}.examples[${index}]`;
    const built: Example = {
      greek: text(example.greek, `${path}.greek`)!,
      russian: text(example.russian, `${path}.russian`)!,
      target: text(example.target, `${path}.target`)!,
    };
    if (!built.greek.includes(built.target)) fail(`${path}: форма «${built.target}» не встречается в предложении`);
    const exampleSource = text(example.source, `${path}.source`, false) ?? source;
    if (exampleSource) built.source = exampleSource;
    if (example.words !== undefined) built.glosses = glossesOf(example.words, built.greek, `${path}.words`);
    return built;
  });
  const draft: Omit<PackageWord, "revision"> = {
    id,
    greek,
    russian,
    ipa: text(src.ipa, `${where}.ipa`, false) ?? "",
    segments,
    examples,
    verified: !!src.verified,
  };
  if (draft.ipa && !/^\/.+\/$/.test(draft.ipa)) fail(`${where}.ipa: транскрипция записывается между косыми чертами`);
  if (draft.verified && !draft.ipa) fail(`${where}: проверенное слово должно иметь IPA`);
  const note = text(src.note, `${where}.note`, false);
  if (note) draft.note = note;
  if (source) draft.source = source;
  if (src.image) draft.imageAssetId = imageAssetId(id);
  if (src.audio) draft.audioAssetId = audioAssetId(id);
  return { ...draft, revision: revisionOf(draft) };
}

/** Фраза и пропуск проходят ту же проверку формы, что и при установке пакета; сборка добавляет ревизию. */
function describePhrase(id: string, src: Sourced<PhraseSource>): PackagePhrase {
  const where = `phrases/${src.file}`;
  checkId(id, where);
  const { file: _file, audio, id: _id, ...rest } = src;
  try {
    const draft = validatePhrase(
      nfc({ ...rest, id, revision: "", ...(audio ? { audioAssetId: audioAssetId(id) } : {}) }),
      where,
    );
    const { revision: _r, ...fields } = draft;
    return { ...fields, revision: phraseRevisionOf(fields) };
  } catch (error) {
    throw error instanceof ContentError
      ? new ContentError(error.message.startsWith(where) ? error.message : `${where}: ${error.message}`)
      : error;
  }
}
function mediaFor(
  id: string,
  file: string,
  dir: "art" | "audio",
  files: Map<string, Uint8Array>,
  labels: { alt: string; source: string },
  where: string,
  legacy: Set<string>,
  art: ArtReport,
): { item: PackageMedia; body: Uint8Array } {
  const body = files.get(`${dir}/${file}`);
  if (!body) fail(`${where}: файла ${dir}/${file} нет`);
  const ext = extname(file).toLowerCase();
  const mimeType = MIME[ext] ?? fail(`${where}: неизвестный тип файла ${file}`);
  // Иллюстрация подчиняется стандарту (docs/art-standard.md); файлы до стандарта из legacy.txt считаются в отчёте о миграции.
  if (dir === "art" && mimeType === "image/svg+xml") {
    art.files++;
    if (checkArt(file, body!, legacy)) art.legacy++;
  }
  const version = hash(body!, 10);
  return {
    body: body!,
    item: {
      id,
      kind: dir === "art" ? "image" : "audio",
      mimeType,
      url: `content/media/${id}@${version}${ext}`,
      bytes: body!.byteLength,
      version,
      required: true,
      alt: labels.alt,
      source: labels.source,
    },
  };
}

const KIND_LABEL: Record<CardKind, { one: string; dir: string }> = {
  word: { one: "слова", dir: "words" },
  phrase: { one: "фразы", dir: "phrases" },
};

/**
 * Одно и то же слово живёт в одном файле и получает один идентификатор во всех уроках.
 * Два файла с одинаковой парой «написание + перевод» — ошибка публикации, а не тихий дубликат.
 * Для фраз дубликат — тот же текст и перевод.
 */
export function buildContent(root = defaultRoot()): BuiltContent {
  const sources = readSources(root);
  const words = new Map<string, PackageWord>();
  const byKey = new Map<string, string>();
  for (const [id, src] of sources.words) {
    const word = describe(id, src);
    const key = wordKey(word.greek, word.russian);
    const twin = byKey.get(key);
    if (twin)
      fail(
        `words/${src.file} повторяет слово «${word.greek} — ${word.russian}» из words/${sources.words.get(twin)!.file}`,
      );
    byKey.set(key, id);
    words.set(id, word);
  }
  // Ссылка отрезка ведёт на слово любого урока каталога: пример урока 4.2 может опираться на слово урока 1.1.
  for (const [id, src] of sources.words)
    words.get(id)!.examples.forEach((example, index) =>
      example.glosses?.forEach((gloss, at) => {
        if (gloss.wordId && !words.has(gloss.wordId))
          fail(
            `words/${src.file}.examples[${index}].words[${at}]: отрезок «${example.greek.slice(gloss.start, gloss.start + gloss.length)}» ссылается на слово ${gloss.wordId}, которого нет в каталоге`,
          );
      }),
    );
  const phrases = new Map<string, PackagePhrase>();
  const phraseByKey = new Map<string, string>();
  for (const [id, src] of sources.phrases) {
    const phrase = describePhrase(id, src);
    const key = phraseKey(phrase.text, phrase.translation);
    const twin = phraseByKey.get(key);
    if (twin)
      fail(`phrases/${src.file} повторяет фразу «${phrase.text}» из phrases/${sources.phrases.get(twin)!.file}`);
    phraseByKey.set(key, id);
    phrases.set(id, phrase);
  }
  /** Список унаследованных картинок только сокращается: имя без файла — мусор, а не исключение. */
  const legacy = readLegacy(sources.files);
  const art: ArtReport = { files: 0, legacy: 0 };
  for (const file of legacy)
    if (!sources.files.has(`art/${file}`)) fail(`art/${LEGACY_FILE}: файла art/${file} нет — уберите имя из списка`);
  const media = new Map<string, { item: PackageMedia; body: Uint8Array }>();
  for (const [id, src] of sources.words) {
    const word = words.get(id)!;
    const labels = { alt: `Иллюстрация к слову «${word.russian}»`, source: ART_SOURCE };
    if (src.image)
      media.set(
        word.imageAssetId!,
        mediaFor(word.imageAssetId!, src.image, "art", sources.files, labels, `words/${src.file}`, legacy, art),
      );
    if (src.audio)
      media.set(
        word.audioAssetId!,
        mediaFor(
          word.audioAssetId!,
          src.audio,
          "audio",
          sources.files,
          { alt: "", source: word.source ?? "" },
          `words/${src.file}`,
          legacy,
          art,
        ),
      );
  }
  for (const [id, src] of sources.phrases)
    if (src.audio)
      media.set(
        audioAssetId(id),
        mediaFor(
          audioAssetId(id),
          src.audio,
          "audio",
          sources.files,
          { alt: "", source: phrases.get(id)!.provenance.sourceLabel },
          `phrases/${src.file}`,
          legacy,
          art,
        ),
      );

  /** Урок принадлежит ровно одному курсу: без курса он потеряется в каталоге, в двух — попадёт в занятие дважды. */
  const courseOf = new Map<string, string>();
  const courses: CatalogCourse[] = [];
  for (const [courseId, src] of sources.courses) {
    const where = `courses/${src.file}`;
    const title = text(src.title, `${where}.title`)!;
    if (!Array.isArray(src.lessons) || !src.lessons.length) fail(`${where}: нужен непустой список lessons`);
    for (const lessonId of src.lessons) {
      if (!sources.lessons.has(lessonId)) fail(`${where}: урока ${lessonId} нет в lessons/`);
      const twin = courseOf.get(lessonId);
      if (twin) fail(`${where}: урок ${lessonId} уже входит в курс ${twin}`);
      courseOf.set(lessonId, courseId);
    }
    // Курс учат целиком, поэтому смешанные языки внутри него — ошибка, а не особенность набора.
    const languages = new Set(src.lessons.map((lessonId) => sources.lessons.get(lessonId)!.language ?? LANGUAGE));
    if (languages.size > 1) fail(`${where}: уроки курса на разных языках — ${[...languages].sort().join(", ")}`);
    const course: CatalogCourse = {
      id: courseId,
      title,
      language: [...languages][0] ?? LANGUAGE,
      lessonIds: [...src.lessons],
    };
    const source = text(src.source, `${where}.source`, false);
    if (source) course.source = source;
    courses.push(course);
  }

  const used = { word: new Set<string>(), phrase: new Set<string>() };
  const cards = { word: words, phrase: phrases } as const;
  const packages: ContentPackage[] = [];
  const entries: CatalogEntry[] = [];
  const files: BuiltFile[] = [];
  for (const [id, src] of sources.lessons) {
    const where = `lessons/${id}.yaml`;
    const courseId = courseOf.get(id) ?? (fail(`${where}: урок не входит ни в один курс`) as string);
    const title = text(src.title, `${where}.title`)!;
    // Положение урока во времени не поставляется: статус занятия и дата принадлежат пользователю.
    for (const field of ["status", "targetDate"] as const)
      if (field in (src as object))
        fail(
          `${where}.${field}: поле не поставляется — статус занятия и дата урока принадлежат пользователю и задаются расписанием курса`,
        );
    // `words` — сокращение словарного урока; `items` — смешанный порядок. Оба сразу делают порядок неоднозначным.
    if (src.words !== undefined && src.items !== undefined) fail(`${where}: укажите либо words, либо items, но не оба`);
    const refs: LessonItemSource[] =
      src.items !== undefined ? src.items : (src.words ?? []).map((wordId) => ({ kind: "word", id: wordId }));
    if (!Array.isArray(refs) || !refs.length)
      fail(`${where}: нужен непустой список ${src.items !== undefined ? "items" : "words"}`);
    const items: PackageItem[] = refs.map((ref, position) => {
      const path = `${where}.${src.items !== undefined ? `items[${position}]` : `words[${position}]`}`;
      if (typeof ref !== "object" || ref === null || typeof ref.id !== "string")
        fail(`${path}: ожидалась пара {kind, id}`);
      if (!(CARD_KINDS as readonly string[]).includes(ref.kind))
        fail(`${path}: неизвестный вид карточки «${String(ref.kind)}»`);
      const kind = ref.kind as CardKind;
      if (!cards[kind].has(ref.id)) fail(`${path}: ${KIND_LABEL[kind].one} ${ref.id} нет в ${KIND_LABEL[kind].dir}/`);
      used[kind].add(ref.id);
      return { kind, id: ref.id, position };
    });
    if (new Set(items.map((item) => `${item.kind}/${item.id}`)).size !== items.length)
      fail(`${where}: карточка повторяется в списке`);
    const packWords = items.filter((item) => item.kind === "word").map((item) => words.get(item.id)!);
    const packPhrases = items.filter((item) => item.kind === "phrase").map((item) => phrases.get(item.id)!);
    const packMedia = [
      ...packWords.flatMap((word) => [word.imageAssetId, word.audioAssetId]),
      ...packPhrases.map((p) => p.audioAssetId),
    ]
      .filter((ref): ref is string => !!ref)
      .map((ref) => media.get(ref)!.item);
    const draft: ContentPackage = {
      schemaVersion: SCHEMA_VERSION,
      id,
      courseId,
      version: "",
      language: src.language ?? LANGUAGE,
      lesson: { title },
      words: packWords,
      phrases: packPhrases,
      items,
      links: items.filter((item) => item.kind === "word").map((item) => ({ wordId: item.id, position: item.position })),
      media: packMedia,
    };
    const version = hash(canonical({ ...draft, version: undefined }));
    const pack = { ...draft, version };
    const body = JSON.stringify(pack);
    const url = `content/packages/${id}@${version}.json`;
    packages.push(pack);
    files.push({ path: url, body, mimeType: "application/json" });
    entries.push({
      id,
      courseId,
      language: pack.language,
      title,
      wordCount: packWords.length,
      wordIds: packWords.map((word) => word.id),
      phraseCount: packPhrases.length,
      cardCount: items.length,
      version,
      url,
      bytes: Buffer.byteLength(body),
      media: { count: packMedia.length, bytes: packMedia.reduce((sum, item) => sum + item.bytes, 0) },
    });
  }
  for (const id of words.keys())
    if (!used.word.has(id))
      fail(`words/${sources.words.get(id)!.file} не входит ни в один урок и не будет опубликовано`);
  for (const id of phrases.keys())
    if (!used.phrase.has(id))
      fail(`phrases/${sources.phrases.get(id)!.file} не входит ни в один урок и не будет опубликована`);
  for (const { item, body } of media.values()) files.push({ path: item.url, body, mimeType: item.mimeType });
  const catalog: Catalog = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    courses,
    lessons: entries,
  };
  files.push({ path: "content/catalog.json", body: JSON.stringify(catalog), mimeType: "application/json" });
  return {
    catalog,
    packages,
    files,
    words: [...words.values()],
    phrases: [...phrases.values()],
    sources,
    art,
  };
}

export const wordsOf = (content: BuiltContent, lessonId: string) => {
  const pack = content.packages.find((p) => p.id === lessonId);
  return pack ? pack.links.map((link) => pack.words.find((word) => word.id === link.wordId)!) : [];
};
// Путь строится без `new URL`: в тестах с jsdom глобальный URL разрешает относительный адрес от http, а не от файла.
export const defaultRoot = () => dirname(fileURLToPath(import.meta.url));

/** Папка очищается целиком: она не хранится в репозитории и собирается перед каждой сборкой. */
export function writeContent(publicDir = "public", root = defaultRoot()) {
  const content = buildContent(root);
  rmSync(join(publicDir, "content"), { recursive: true, force: true });
  for (const file of content.files) {
    const target = join(publicDir, file.path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, file.body);
  }
  return content;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const built = writeContent();
  console.log(
    `Контент: ${built.packages.length} пакетов, ${built.words.length} слов, ${built.phrases.length} фраз, ${built.files.length} файлов → public/content`,
  );
  console.log(`Иллюстрации: ${built.art.files}, вне палитры (art/${LEGACY_FILE}): ${built.art.legacy}`);
}
