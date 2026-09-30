import type {
  CardKind,
  Example,
  Gloss,
  Provenance,
  ProvenanceOperation,
  Segment,
  SourceRecord,
} from "../domain/types.ts";
import { CARD_KINDS } from "../domain/types.ts";

/**
 * Контракт поставляемого контента. Каталог — только метаданные; пакет — урок целиком.
 * Пакеты неизменяемы: версия входит в URL, поэтому старые адреса продолжают работать.
 * Положение урока во времени — статус занятия и дата — контентом не поставляется: оно
 * принадлежит пользователю и живёт только в его базе. Версия 2 — это их удаление.
 * Версия 3 — смешанный урок: слова, фразы, задания с пропуском и упорядоченные типизированные связи.
 * Читатель принимает версии 2 и 3; словарный пакет версии 2 представляется уроком из слов.
 */
export const SCHEMA_VERSION = 3;
export const SUPPORTED_SCHEMAS = [2, 3] as const;
export type SupportedSchema = (typeof SUPPORTED_SCHEMAS)[number];

export interface CatalogCourse {
  id: string;
  title: string;
  language: string;
  source?: string;
  lessonIds: string[];
}
export interface CatalogEntry {
  id: string;
  courseId: string;
  language: string;
  title: string;
  wordCount: number;
  /** Слова урока в порядке состава; каталог прежней сборки их не перечисляет. */
  wordIds?: string[];
  phraseCount: number;
  cardCount: number;
  version: string;
  url: string;
  bytes: number;
  media: { count: number; bytes: number };
}
export interface Catalog {
  schemaVersion: SupportedSchema;
  generatedAt: string;
  courses: CatalogCourse[];
  lessons: CatalogEntry[];
}

export interface PackageWord {
  id: string;
  greek: string;
  russian: string;
  ipa: string;
  note?: string;
  segments: Segment[];
  examples: Example[];
  imageAssetId?: string;
  audioAssetId?: string;
  verified: boolean;
  source?: string;
  revision: string;
}
export interface PackagePhrase {
  id: string;
  text: string;
  translation?: string;
  usage?: string;
  note?: string;
  audioAssetId?: string;
  provenance: Provenance;
  revision: string;
}
/** Словарная связь прежнего формата; в схеме 3 выводится из `items` для кода, который ещё работает только со словами. */
export interface PackageLink {
  wordId: string;
  position: number;
}
export interface PackageItem {
  kind: CardKind;
  id: string;
  position: number;
}
export interface PackageMedia {
  id: string;
  kind: "image" | "audio";
  mimeType: string;
  url: string;
  bytes: number;
  version: string;
  required: boolean;
  alt: string;
  source: string;
}
export interface ContentPackage {
  schemaVersion: SupportedSchema;
  id: string;
  courseId: string;
  version: string;
  language: string;
  lesson: { title: string };
  words: PackageWord[];
  phrases: PackagePhrase[];
  items: PackageItem[];
  links: PackageLink[];
  media: PackageMedia[];
}

export type ContentErrorKind = "schema" | "unsupported" | "network" | "storage";
export class ContentError extends Error {
  readonly kind: ContentErrorKind;
  constructor(message: string, kind: ContentErrorKind = "schema") {
    super(message);
    this.kind = kind;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, path: string): string => {
  if (typeof value !== "string") throw new ContentError(`${path}: ожидалась строка`);
  return value;
};
const num = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new ContentError(`${path}: ожидалось число`);
  return value;
};
const bool = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") throw new ContentError(`${path}: ожидалось да/нет`);
  return value;
};
const opt = <T>(value: unknown, read: (v: unknown) => T): T | undefined =>
  value === undefined || value === null ? undefined : read(value);
const list = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) throw new ContentError(`${path}: ожидался список`);
  return value;
};
const obj = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new ContentError(`${path}: ожидался объект`);
  return value;
};
const relativeUrl = (value: unknown, path: string): string => {
  const url = str(value, path);
  if (!url || url.startsWith("/") || url.includes("..") || /^[a-z]+:/i.test(url))
    throw new ContentError(`${path}: ссылка должна быть относительной`);
  return url;
};
const unique = (ids: string[], path: string) => {
  if (new Set(ids).size !== ids.length) throw new ContentError(`${path}: идентификаторы повторяются`);
};
const isCardKind = (value: unknown): value is CardKind =>
  typeof value === "string" && (CARD_KINDS as readonly string[]).includes(value);
const cardKind = (value: unknown, path: string): CardKind => {
  if (!isCardKind(value)) throw new ContentError(`${path}: неизвестный вид карточки «${String(value)}»`);
  return value;
};

function checkSchemaVersion(raw: Record<string, unknown>, what: string): SupportedSchema {
  const version = raw.schemaVersion;
  if (!(SUPPORTED_SCHEMAS as readonly unknown[]).includes(version))
    throw new ContentError(
      `${what} версии схемы ${String(version)} не поддерживается этой версией приложения`,
      "unsupported",
    );
  return version as SupportedSchema;
}

export function parseCatalog(input: unknown): Catalog {
  const raw = obj(input, "каталог");
  const schemaVersion = checkSchemaVersion(raw, "Каталог");
  const lessons = list(raw.lessons, "каталог.lessons").map((entry, index): CatalogEntry => {
    const path = `каталог.lessons[${index}]`;
    const item = obj(entry, path);
    const media = obj(item.media ?? { count: 0, bytes: 0 }, `${path}.media`);
    const head = {
      id: str(item.id, `${path}.id`),
      courseId: str(item.courseId ?? "", `${path}.courseId`),
      language: str(item.language, `${path}.language`),
      title: str(item.title, `${path}.title`),
    };
    // Каталог схемы 2 знает только слова: счётчик фраз равен нулю, а число карточек — числу слов.
    // Счётчик снятого вида из прежних каталогов не читается: в число карточек он входит через `cardCount`.
    const wordCount = num(item.wordCount, `${path}.wordCount`);
    const phraseCount = num(item.phraseCount ?? 0, `${path}.phraseCount`);
    const lesson: CatalogEntry = {
      ...head,
      wordCount,
      phraseCount,
      cardCount: num(item.cardCount ?? wordCount + phraseCount, `${path}.cardCount`),
      version: str(item.version, `${path}.version`),
      url: relativeUrl(item.url, `${path}.url`),
      bytes: num(item.bytes, `${path}.bytes`),
      media: { count: num(media.count, `${path}.media.count`), bytes: num(media.bytes, `${path}.media.bytes`) },
    };
    const wordIds = opt(item.wordIds, (value) =>
      list(value, `${path}.wordIds`).map((id, i) => str(id, `${path}.wordIds[${i}]`)),
    );
    if (wordIds) lesson.wordIds = wordIds;
    return lesson;
  });
  unique(
    lessons.map((l) => l.id),
    "каталог.lessons",
  );
  const courses = list(raw.courses ?? [], "каталог.courses").map((entry, index): CatalogCourse => {
    const path = `каталог.courses[${index}]`;
    const item = obj(entry, path);
    const course: CatalogCourse = {
      id: str(item.id, `${path}.id`),
      title: str(item.title, `${path}.title`),
      language: str(item.language ?? "", `${path}.language`),
      lessonIds: list(item.lessonIds ?? [], `${path}.lessonIds`).map((value, i) =>
        str(value, `${path}.lessonIds[${i}]`),
      ),
    };
    const source = opt(item.source, (value) => str(value, `${path}.source`));
    if (source) course.source = source;
    return course;
  });
  unique(
    courses.map((course) => course.id),
    "каталог.courses",
  );
  return { schemaVersion, generatedAt: str(raw.generatedAt, "каталог.generatedAt"), courses, lessons };
}

/** Отрезки идут по порядку, не пересекаются и лежат внутри предложения: иначе нажатие показало бы чужой текст. */
function parseGlosses(input: unknown, greek: string, path: string): Gloss[] {
  let end = 0;
  return list(input, path).map((entry, i): Gloss => {
    const at = `${path}[${i}]`;
    const raw = obj(entry, at);
    const gloss: Gloss = {
      start: num(raw.start, `${at}.start`),
      length: num(raw.length, `${at}.length`),
      russian: str(raw.russian, `${at}.russian`),
    };
    if (!Number.isInteger(gloss.start) || !Number.isInteger(gloss.length) || gloss.length < 1)
      throw new ContentError(`${at}: границы отрезка должны быть целыми, а длина — не меньше 1`);
    if (gloss.start < end) throw new ContentError(`${at}: отрезки пересекаются или идут не по порядку`);
    if (gloss.start + gloss.length > greek.length) throw new ContentError(`${at}: отрезок выходит за предложение`);
    if (!gloss.russian.trim()) throw new ContentError(`${at}: у отрезка нет перевода`);
    const wordId = opt(raw.wordId, (v) => str(v, `${at}.wordId`));
    if (wordId) gloss.wordId = wordId;
    end = gloss.start + gloss.length;
    return gloss;
  });
}

function parseWord(input: unknown, path: string): PackageWord {
  const raw = obj(input, path);
  const segments = list(raw.segments ?? [], `${path}.segments`).map((entry, i): Segment => {
    const seg = obj(entry, `${path}.segments[${i}]`);
    return {
      text: str(seg.text, `${path}.segments[${i}].text`),
      ipa: str(seg.ipa, `${path}.segments[${i}].ipa`),
      explanation: str(seg.explanation, `${path}.segments[${i}].explanation`),
      start: num(seg.start, `${path}.segments[${i}].start`),
    };
  });
  const examples = list(raw.examples ?? [], `${path}.examples`).map((entry, i): Example => {
    const ex = obj(entry, `${path}.examples[${i}]`);
    const example: Example = {
      greek: str(ex.greek, `${path}.examples[${i}].greek`),
      russian: str(ex.russian, `${path}.examples[${i}].russian`),
      target: str(ex.target, `${path}.examples[${i}].target`),
      source: opt(ex.source, (v) => str(v, `${path}.examples[${i}].source`)),
    };
    const glosses = opt(ex.glosses, (v) => parseGlosses(v, example.greek, `${path}.examples[${i}].glosses`));
    if (glosses) example.glosses = glosses;
    return example;
  });
  const word: PackageWord = {
    id: str(raw.id, `${path}.id`),
    greek: str(raw.greek, `${path}.greek`),
    russian: str(raw.russian, `${path}.russian`),
    ipa: str(raw.ipa ?? "", `${path}.ipa`),
    segments,
    examples,
    verified: bool(raw.verified ?? false, `${path}.verified`),
    revision: str(raw.revision, `${path}.revision`),
  };
  const note = opt(raw.note, (v) => str(v, `${path}.note`));
  if (note) word.note = note;
  const source = opt(raw.source, (v) => str(v, `${path}.source`));
  if (source) word.source = source;
  const image = opt(raw.imageAssetId, (v) => str(v, `${path}.imageAssetId`));
  if (image) word.imageAssetId = image;
  const audio = opt(raw.audioAssetId, (v) => str(v, `${path}.audioAssetId`));
  if (audio) word.audioAssetId = audio;
  if (!word.greek.trim() || !word.russian.trim()) throw new ContentError(`${path}: у слова нет написания или перевода`);
  return word;
}

export const PROVENANCE_OPERATIONS: readonly ProvenanceOperation[] = [
  "verbatim",
  "requested-transform",
  "requested-generation",
];
/** Поля, у которых может быть своё происхождение: имена частей — идентификаторы в kebab-case. */
export const PROVENANCE_PARTS: readonly string[] = ["translation", "usage", "note", "explanation", "audio"];
function validateSource(input: unknown, path: string): SourceRecord {
  const raw = obj(input, path);
  const operation = str(raw.operation, `${path}.operation`);
  if (!(PROVENANCE_OPERATIONS as readonly string[]).includes(operation))
    throw new ContentError(`${path}.operation: неизвестная операция «${operation}»`);
  const record: SourceRecord = {
    sourceLabel: str(raw.sourceLabel, `${path}.sourceLabel`),
    operation: operation as ProvenanceOperation,
  };
  if (!record.sourceLabel.trim()) throw new ContentError(`${path}.sourceLabel: не может быть пустым`);
  const locator = opt(raw.locator, (v) => str(v, `${path}.locator`));
  if (locator) record.locator = locator;
  const excerpt = opt(raw.excerpt, (v) => str(v, `${path}.excerpt`));
  if (excerpt) record.excerpt = excerpt;
  const request = opt(raw.request, (v) => str(v, `${path}.request`));
  if (request?.trim()) record.request = request;
  if (operation.startsWith("requested-") && !record.request)
    throw new ContentError(`${path}.request: для операции ${operation} нужен текст запроса пользователя`);
  return record;
}
/**
 * Происхождение обязательно у фраз и пропусков; запрошенные преобразование и генерация несут текст запроса.
 * `parts` описывает поля, чьё происхождение отличается от основного текста, и сам частей не имеет.
 */
export function validateProvenance(input: unknown, path: string): Provenance {
  if (input === undefined || input === null)
    throw new ContentError(`${path}: нужно provenance — происхождение материала`);
  const raw = obj(input, path);
  const provenance: Provenance = validateSource(raw, path);
  if (raw.parts !== undefined && raw.parts !== null) {
    const parts = obj(raw.parts, `${path}.parts`);
    const flat: Record<string, SourceRecord> = {};
    for (const [field, value] of Object.entries(parts)) {
      if (!PROVENANCE_PARTS.includes(field))
        throw new ContentError(
          `${path}.parts.${field}: у этого поля не бывает отдельного происхождения — ${PROVENANCE_PARTS.join(", ")}`,
        );
      if (obj(value, `${path}.parts.${field}`).parts !== undefined)
        throw new ContentError(`${path}.parts.${field}.parts: происхождение части не делится дальше`);
      flat[field] = validateSource(value, `${path}.parts.${field}`);
    }
    if (Object.keys(flat).length) provenance.parts = flat;
  }
  return provenance;
}

export function validatePhrase(input: unknown, path: string): PackagePhrase {
  const raw = obj(input, path);
  const text = str(raw.text, `${path}.text`);
  if (!text.trim()) throw new ContentError(`${path}.text: у фразы нет текста`);
  const phrase: PackagePhrase = {
    id: str(raw.id, `${path}.id`),
    text,
    provenance: validateProvenance(raw.provenance, `${path}.provenance`),
    revision: str(raw.revision, `${path}.revision`),
  };
  for (const field of ["translation", "usage", "note", "audioAssetId"] as const) {
    const value = opt(raw[field], (v) => str(v, `${path}.${field}`));
    if (value) phrase[field] = value;
  }
  return phrase;
}

export function parsePackage(input: unknown): ContentPackage {
  const raw = obj(input, "пакет");
  const schemaVersion = checkSchemaVersion(raw, "Пакет");
  const lessonRaw = obj(raw.lesson, "пакет.lesson");
  const words = list(raw.words, "пакет.words").map((entry, i) => parseWord(entry, `пакет.words[${i}]`));
  unique(
    words.map((w) => w.id),
    "пакет.words",
  );
  let phrases: PackagePhrase[] = [],
    items: PackageItem[];
  if (schemaVersion === 2) {
    // Словарный пакет: смешанные поля в нём не читаются, чтобы новый контент не выдавал себя за старый.
    for (const field of ["phrases", "items"])
      if (raw[field] !== undefined) throw new ContentError(`пакет.${field}: поле не входит в пакет схемы 2`);
    const known = new Set(words.map((w) => w.id));
    items = list(raw.links, "пакет.links").map((entry, i): PackageItem => {
      const link = obj(entry, `пакет.links[${i}]`);
      const wordId = str(link.wordId, `пакет.links[${i}].wordId`);
      if (!known.has(wordId))
        throw new ContentError(`пакет.links[${i}]: связь указывает на слово ${wordId}, которого нет в пакете`);
      return { kind: "word", id: wordId, position: num(link.position, `пакет.links[${i}].position`) };
    });
  } else {
    phrases = list(raw.phrases ?? [], "пакет.phrases").map((entry, i) => validatePhrase(entry, `пакет.phrases[${i}]`));
    unique(
      phrases.map((p) => p.id),
      "пакет.phrases",
    );
    // Поле снятого вида не читается: состав, который на него ссылается, отклоняет пакет по неизвестному виду.
    const known = {
      word: new Set(words.map((w) => w.id)),
      phrase: new Set(phrases.map((p) => p.id)),
    };
    items = list(raw.items, "пакет.items").map((entry, i): PackageItem => {
      const path = `пакет.items[${i}]`;
      const item = obj(entry, path);
      const kind = cardKind(item.kind, `${path}.kind`);
      const id = str(item.id, `${path}.id`);
      if (!known[kind].has(id))
        throw new ContentError(`${path}: связь указывает на карточку ${kind}/${id}, которой нет в пакете`);
      return { kind, id, position: num(item.position, `${path}.position`) };
    });
    // `related` — навигационная ссылка на материал каталога: связанное слово может жить в другом уроке, поэтому в пакете не требуется.
    if (!items.length) throw new ContentError("пакет.items: в уроке нет карточек");
  }
  unique(
    items.map((item) => `${item.kind} ${item.id}`),
    "пакет.items",
  );
  unique(
    items.map((item) => String(item.position)),
    "пакет.items.position",
  );
  items = [...items].sort((a, b) => a.position - b.position);
  const media = list(raw.media ?? [], "пакет.media").map((entry, i): PackageMedia => {
    const path = `пакет.media[${i}]`;
    const item = obj(entry, path);
    const kind = item.kind;
    if (kind !== "image" && kind !== "audio") throw new ContentError(`${path}.kind: неизвестный тип медиа`);
    return {
      id: str(item.id, `${path}.id`),
      kind,
      mimeType: str(item.mimeType, `${path}.mimeType`),
      url: relativeUrl(item.url, `${path}.url`),
      bytes: num(item.bytes, `${path}.bytes`),
      version: str(item.version, `${path}.version`),
      required: bool(item.required ?? false, `${path}.required`),
      alt: str(item.alt ?? "", `${path}.alt`),
      source: str(item.source ?? "", `${path}.source`),
    };
  });
  unique(
    media.map((m) => m.id),
    "пакет.media",
  );
  const mediaIds = new Set(media.map((m) => m.id));
  for (const word of words)
    for (const ref of [word.imageAssetId, word.audioAssetId])
      if (ref && !mediaIds.has(ref))
        throw new ContentError(`пакет.words: слово ${word.id} ссылается на медиа ${ref}, которого нет в пакете`);
  for (const card of phrases)
    if (card.audioAssetId && !mediaIds.has(card.audioAssetId))
      throw new ContentError(
        `пакет: карточка ${card.id} ссылается на медиа ${card.audioAssetId}, которого нет в пакете`,
      );
  return {
    schemaVersion,
    id: str(raw.id, "пакет.id"),
    courseId: str(raw.courseId ?? "", "пакет.courseId"),
    version: str(raw.version, "пакет.version"),
    language: str(raw.language, "пакет.language"),
    lesson: { title: str(lessonRaw.title, "пакет.lesson.title") },
    words,
    phrases,
    items,
    links: items.filter((item) => item.kind === "word").map((item) => ({ wordId: item.id, position: item.position })),
    media,
  };
}

/** Поля слова, которые поставляет пакет; остальное принадлежит пользователю. */
export const SHIPPED_FIELDS = [
  "greek",
  "russian",
  "ipa",
  "note",
  "segments",
  "examples",
  "imageAssetId",
  "audioAssetId",
  "verified",
  "source",
] as const;
export type ShippedField = (typeof SHIPPED_FIELDS)[number];
/** Поставляемые поля фразы: из них считается ревизия. */
export const PHRASE_FIELDS = ["text", "translation", "usage", "note", "audioAssetId", "provenance"] as const;
