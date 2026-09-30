/**
 * Модель полноценного курса (схема 4): модуль программы, уроки из упорядоченных блоков и правило публикации.
 * Одни и те же проверки выполняют сборщик контента и клиент: пакет, который не прошёл бы сборку, клиент тоже
 * не примет. Карточки слов и фраз остаются частью урока как раньше; блоки добавляют объяснение, задания с ключом,
 * чтение, аудирование, письмо и речь.
 */
import { ContentError } from "./schema-errors.ts";

export const SKILLS = ["reading", "listening", "writing", "speaking"] as const;
export type Skill = (typeof SKILLS)[number];
export const SKILL_LABEL: Record<Skill, string> = {
  reading: "чтение",
  listening: "аудирование",
  writing: "письмо",
  speaking: "речь",
};

export type ModuleStatus = "draft" | "published";
export type LessonKind = "lesson" | "test";

/** Таблица объяснения: строки одинаковой длины, заголовок необязателен. */
export interface BlockTable {
  columns?: string[];
  rows: string[][];
}
export interface ExplanationBlock {
  type: "explanation";
  id: string;
  title?: string;
  /** Абзацы через пустую строку; `**…**` — выделение. */
  body: string;
  table?: BlockTable;
}
/** Карточки урока (слова и фразы из `items`) в этом месте урока. */
export interface VocabularyBlock {
  type: "vocabulary";
  id: string;
  title?: string;
}
/**
 * Форматы заданий экзамена: `choice` — выбор из вариантов (в том числе верно/неверно), `text` — ввод ответа,
 * `gap` — пропуск со словом из общего банка, `match` — соединение с вариантом из общего банка.
 */
export const EXERCISE_FORMATS = ["choice", "text", "gap", "match"] as const;
export type ExerciseFormat = (typeof EXERCISE_FORMATS)[number];
export interface ExerciseItem {
  id: string;
  prompt: string;
  /** Варианты `choice`; у `gap` и `match` варианты — общий банк задания. */
  options?: string[];
  /** Принимаемые ответы: для выбора — ровно один из вариантов, для ввода — допустимые формы. */
  answer: string[];
  /** Пояснение, которое показывается после ответа: почему так, где типичная ошибка. */
  explanation?: string;
}
export interface ExerciseBlock {
  type: "exercise";
  id: string;
  title?: string;
  instruction: string;
  format: ExerciseFormat;
  /** Блок чтения или аудирования, к которому относится задание; навык задания выводится из него. */
  about?: string;
  bank?: string[];
  items: ExerciseItem[];
  /** Входит в оценку контрольной урока `test`. */
  graded?: boolean;
}
export interface Gloss {
  text: string;
  russian: string;
}
export interface ReadingBlock {
  type: "reading";
  id: string;
  title: string;
  text: string;
  glosses?: Gloss[];
  source?: string;
}
export interface TranscriptLine {
  speaker?: string;
  text: string;
}
export interface ListeningBlock {
  type: "listening";
  id: string;
  title: string;
  /**
   * Идентификатор медиа пакета — если есть запись. Без записи приложение читает транскрипт синтезом речи
   * устройства (греческий голос установлен у учащегося): реплики разных говорящих — разными голосами, если их больше одного.
   */
  audioAssetId?: string;
  transcript: TranscriptLine[];
  /** Сколько раз запись звучит до ответа; на экзамене — дважды. */
  plays: number;
  source?: string;
}
export type Register = "friendly" | "formal";
export interface WritingBlock {
  type: "writing";
  id: string;
  register: Register;
  prompt: string;
  words: { min: number; max: number };
  model: string;
  criteria: string[];
}
export type SpeakingPart = "interview" | "monologue" | "roleplay";
export interface SpeakingBlock {
  type: "speaking";
  id: string;
  part: SpeakingPart;
  prompt: string;
  seconds: number;
  model?: string;
  criteria: string[];
}
export type LessonBlock =
  ExplanationBlock | VocabularyBlock | ExerciseBlock | ReadingBlock | ListeningBlock | WritingBlock | SpeakingBlock;
export const BLOCK_TYPES = [
  "explanation",
  "vocabulary",
  "exercise",
  "reading",
  "listening",
  "writing",
  "speaking",
] as const;

export interface CatalogModule {
  id: string;
  courseId: string;
  number: number;
  /** Название по-гречески и по-русски: «Γνωριμία» / «Знакомство». */
  title: string;
  subtitle: string;
  status: ModuleStatus;
  goal: string;
  grammar: string[];
  /** Сколько занятий по плану отводится модулю. */
  sessions: number;
  /** Уроки опубликованного модуля; у черновика — пусто: его уроки не поставляются. */
  lessonIds: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const obj = (value: unknown, path: string) => {
  if (!isRecord(value)) throw new ContentError(`${path}: ожидался объект`);
  return value;
};
const list = (value: unknown, path: string) => {
  if (!Array.isArray(value)) throw new ContentError(`${path}: ожидался список`);
  return value as unknown[];
};
const str = (value: unknown, path: string, required = true) => {
  if (typeof value !== "string") throw new ContentError(`${path}: ожидалась строка`);
  if (required && !value.trim()) throw new ContentError(`${path}: не может быть пустым`);
  return value;
};
const optStr = (value: unknown, path: string) => (value === undefined || value === null ? undefined : str(value, path));
const int = (value: unknown, path: string, min = 0) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min)
    throw new ContentError(`${path}: ожидалось целое число не меньше ${min}`);
  return value;
};
const strings = (value: unknown, path: string, nonEmpty = true) => {
  const items = list(value, path).map((item, i) => str(item, `${path}[${i}]`));
  if (nonEmpty && !items.length) throw new ContentError(`${path}: нужен непустой список`);
  return items;
};
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], path: string): T => {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value))
    throw new ContentError(`${path}: ожидалось одно из ${allowed.join(", ")}`);
  return value as T;
};
/**
 * Неизвестное поле — ошибка, а не тихий пропуск: в YAML запятая без кавычек внутри `{ … }` отрезает хвост строки
 * в отдельный ключ, и текст урока молча теряется. Поле со значением `undefined` считается отсутствующим.
 */
const FIELDS: Record<string, readonly string[]> = {
  explanation: ["type", "id", "title", "body", "table"],
  vocabulary: ["type", "id", "title"],
  exercise: ["type", "id", "title", "instruction", "format", "about", "bank", "items", "graded"],
  reading: ["type", "id", "title", "text", "glosses", "source"],
  listening: ["type", "id", "title", "audioAssetId", "transcript", "plays", "source"],
  writing: ["type", "id", "register", "prompt", "words", "model", "criteria"],
  speaking: ["type", "id", "part", "prompt", "seconds", "model", "criteria"],
  item: ["id", "prompt", "options", "answer", "explanation"],
  line: ["speaker", "text"],
  gloss: ["text", "russian"],
  table: ["columns", "rows"],
  words: ["min", "max"],
};
function onlyKnown(raw: Record<string, unknown>, kind: string, path: string) {
  for (const [key, value] of Object.entries(raw))
    if (value !== undefined && !FIELDS[kind].includes(key))
      throw new ContentError(
        `${path}: лишнее поле «${key}» — проверьте запятые: в YAML внутри { … } текст с запятой берут в кавычки`,
      );
}

/** Идентификаторы блоков и пунктов — ключи прогресса: только латиница, цифры и дефис, без пробелов. */
const ID = /^[a-z0-9][a-z0-9-]*$/;
const id = (value: unknown, path: string) => {
  const raw = str(value, path);
  if (!ID.test(raw)) throw new ContentError(`${path}: идентификатор «${raw}» — только a-z, 0-9 и дефис`);
  return raw;
};
const unique = (ids: string[], path: string) => {
  const seen = new Set<string>();
  for (const value of ids) {
    if (seen.has(value)) throw new ContentError(`${path}: идентификатор «${value}» повторяется`);
    seen.add(value);
  }
};

function parseTable(input: unknown, path: string): BlockTable {
  const raw = obj(input, path);
  onlyKnown(raw, "table", path);
  const rows = list(raw.rows, `${path}.rows`).map((row, i) => strings(row, `${path}.rows[${i}]`));
  if (!rows.length) throw new ContentError(`${path}.rows: нужен непустой список`);
  const columns = raw.columns === undefined ? undefined : strings(raw.columns, `${path}.columns`);
  const width = columns?.length ?? rows[0].length;
  rows.forEach((row, i) => {
    if (row.length !== width) throw new ContentError(`${path}.rows[${i}]: ${row.length} ячеек вместо ${width}`);
  });
  return columns ? { columns, rows } : { rows };
}

function parseExercise(raw: Record<string, unknown>, path: string, blockId: string): ExerciseBlock {
  const format = oneOf(raw.format, EXERCISE_FORMATS, `${path}.format`);
  const bank = raw.bank === undefined ? undefined : strings(raw.bank, `${path}.bank`);
  if ((format === "gap" || format === "match") && !bank)
    throw new ContentError(`${path}.bank: у задания ${format} нужен банк вариантов`);
  const items = list(raw.items, `${path}.items`).map((entry, i): ExerciseItem => {
    const at = `${path}.items[${i}]`;
    const item = obj(entry, at);
    onlyKnown(item, "item", at);
    const answer =
      typeof item.answer === "string" ? [str(item.answer, `${at}.answer`)] : strings(item.answer, `${at}.answer`);
    const parsed: ExerciseItem = { id: id(item.id, `${at}.id`), prompt: str(item.prompt, `${at}.prompt`), answer };
    if (format === "choice") {
      const options = strings(item.options, `${at}.options`);
      if (options.length < 2) throw new ContentError(`${at}.options: нужно не меньше двух вариантов`);
      unique(options, `${at}.options`);
      if (answer.length !== 1 || !options.includes(answer[0]))
        throw new ContentError(`${at}.answer: ответ должен быть ровно одним из вариантов`);
      parsed.options = options;
    } else if (item.options !== undefined) throw new ContentError(`${at}.options: варианты бывают только у choice`);
    if ((format === "gap" || format === "match") && (answer.length !== 1 || !bank!.includes(answer[0])))
      throw new ContentError(`${at}.answer: ответ должен быть одним из вариантов банка`);
    if (format === "gap" && !parsed.prompt.includes("___"))
      throw new ContentError(`${at}.prompt: в задании с пропуском нужен пропуск «___»`);
    const explanation = optStr(item.explanation, `${at}.explanation`);
    if (explanation) parsed.explanation = explanation;
    return parsed;
  });
  if (!items.length) throw new ContentError(`${path}.items: в задании нет пунктов`);
  unique(
    items.map((item) => item.id),
    `${path}.items`,
  );
  if (bank) {
    unique(bank, `${path}.bank`);
    // В банке должны быть лишние варианты (как на экзамене) или хотя бы все ответы.
    if (format === "match" && bank.length < items.length)
      throw new ContentError(`${path}.bank: вариантов меньше, чем пунктов`);
  }
  const block: ExerciseBlock = {
    type: "exercise",
    id: blockId,
    instruction: str(raw.instruction, `${path}.instruction`),
    format,
    items,
  };
  const title = optStr(raw.title, `${path}.title`);
  if (title) block.title = title;
  const about = optStr(raw.about, `${path}.about`);
  if (about) block.about = about;
  if (bank) block.bank = bank;
  if (raw.graded !== undefined) {
    if (typeof raw.graded !== "boolean") throw new ContentError(`${path}.graded: ожидалось да/нет`);
    if (raw.graded) block.graded = true;
  }
  return block;
}

export function parseBlock(input: unknown, path: string): LessonBlock {
  const raw = obj(input, path);
  const type = oneOf(raw.type, BLOCK_TYPES, `${path}.type`);
  onlyKnown(raw, type, path);
  const blockId = id(raw.id, `${path}.id`);
  const title = optStr(raw.title, `${path}.title`);
  switch (type) {
    case "explanation": {
      const block: ExplanationBlock = { type, id: blockId, body: str(raw.body, `${path}.body`) };
      if (title) block.title = title;
      if (raw.table !== undefined) block.table = parseTable(raw.table, `${path}.table`);
      return block;
    }
    case "vocabulary":
      return title ? { type, id: blockId, title } : { type, id: blockId };
    case "exercise":
      return parseExercise(raw, path, blockId);
    case "reading": {
      const block: ReadingBlock = {
        type,
        id: blockId,
        title: str(raw.title, `${path}.title`),
        text: str(raw.text, `${path}.text`),
      };
      if (raw.glosses !== undefined)
        block.glosses = list(raw.glosses, `${path}.glosses`).map((entry, i) => {
          const gloss = obj(entry, `${path}.glosses[${i}]`);
          onlyKnown(gloss, "gloss", `${path}.glosses[${i}]`);
          const text = str(gloss.text, `${path}.glosses[${i}].text`);
          if (!block.text.includes(text))
            throw new ContentError(`${path}.glosses[${i}]: «${text}» не найдено в тексте`);
          return { text, russian: str(gloss.russian, `${path}.glosses[${i}].russian`) };
        });
      const source = optStr(raw.source, `${path}.source`);
      if (source) block.source = source;
      return block;
    }
    case "listening": {
      const transcript = list(raw.transcript, `${path}.transcript`).map((entry, i): TranscriptLine => {
        const line = obj(entry, `${path}.transcript[${i}]`);
        onlyKnown(line, "line", `${path}.transcript[${i}]`);
        const speaker = optStr(line.speaker, `${path}.transcript[${i}].speaker`);
        const text = str(line.text, `${path}.transcript[${i}].text`);
        return speaker ? { speaker, text } : { text };
      });
      if (!transcript.length) throw new ContentError(`${path}.transcript: у аудио нужен транскрипт`);
      const block: ListeningBlock = {
        type,
        id: blockId,
        title: str(raw.title, `${path}.title`),
        transcript,
        plays: int(raw.plays ?? 2, `${path}.plays`, 1),
      };
      const audio = optStr(raw.audioAssetId, `${path}.audioAssetId`);
      if (audio) block.audioAssetId = audio;
      const source = optStr(raw.source, `${path}.source`);
      if (source) block.source = source;
      return block;
    }
    case "writing": {
      const words = obj(raw.words, `${path}.words`);
      onlyKnown(words, "words", `${path}.words`);
      const min = int(words.min, `${path}.words.min`, 1);
      const max = int(words.max, `${path}.words.max`, min);
      return {
        type,
        id: blockId,
        register: oneOf(raw.register, ["friendly", "formal"] as const, `${path}.register`),
        prompt: str(raw.prompt, `${path}.prompt`),
        words: { min, max },
        model: str(raw.model, `${path}.model`),
        criteria: strings(raw.criteria, `${path}.criteria`),
      };
    }
    case "speaking": {
      const block: SpeakingBlock = {
        type,
        id: blockId,
        part: oneOf(raw.part, ["interview", "monologue", "roleplay"] as const, `${path}.part`),
        prompt: str(raw.prompt, `${path}.prompt`),
        seconds: int(raw.seconds, `${path}.seconds`, 10),
        criteria: strings(raw.criteria, `${path}.criteria`),
      };
      const model = optStr(raw.model, `${path}.model`);
      if (model) block.model = model;
      return block;
    }
  }
}

/** Блоки урока: идентификаторы уникальны, `about` указывает на чтение или аудирование этого же урока. */
export function parseBlocks(input: unknown, path: string): LessonBlock[] {
  const blocks = list(input, path).map((entry, i) => parseBlock(entry, `${path}[${i}]`));
  unique(
    blocks.map((block) => block.id),
    path,
  );
  const texts = new Map(
    blocks.filter((block) => block.type === "reading" || block.type === "listening").map((block) => [block.id, block]),
  );
  blocks.forEach((block, i) => {
    if (block.type === "exercise" && block.about && !texts.has(block.about))
      throw new ContentError(`${path}[${i}].about: блока чтения или аудирования «${block.about}» нет в уроке`);
  });
  return blocks;
}

/** Навык, который тренирует блок; объяснение и лексика навыка не имеют. */
export function skillOf(block: LessonBlock, blocks: LessonBlock[]): Skill | null {
  if (block.type === "reading" || block.type === "listening" || block.type === "writing" || block.type === "speaking")
    return block.type;
  if (block.type === "exercise" && block.about) {
    const target = blocks.find((other) => other.id === block.about);
    return target?.type === "reading" || target?.type === "listening" ? target.type : null;
  }
  return null;
}

export interface LessonForPublication {
  id: string;
  kind: LessonKind;
  blocks: LessonBlock[];
}
/**
 * Модуль публикуется только полным: четыре навыка с заданиями, аудирование с транскриптом и контрольная с оцениваемыми
 * заданиями. Возвращает список недостающего; пустой список — модуль можно публиковать.
 */
export function publicationGaps(lessons: LessonForPublication[]): string[] {
  const gaps: string[] = [];
  if (!lessons.length) return ["в модуле нет уроков"];
  for (const lesson of lessons) if (!lesson.blocks.length) gaps.push(`урок ${lesson.id}: нет блоков`);
  const all = lessons.flatMap((lesson) => lesson.blocks.map((block) => ({ lesson, block })));
  const answered = (target: string) =>
    all.some(({ block }) => block.type === "exercise" && block.about === target && block.items.length);
  const readings = all.filter(({ block }) => block.type === "reading");
  if (!readings.length) gaps.push("нет текста для чтения");
  else if (!readings.some(({ block }) => answered(block.id))) gaps.push("к чтению нет заданий");
  const listenings = all.filter(({ block }) => block.type === "listening");
  if (!listenings.length) gaps.push("нет аудирования");
  if (listenings.length && !listenings.some(({ block }) => answered(block.id))) gaps.push("к аудированию нет заданий");
  if (!all.some(({ block }) => block.type === "writing")) gaps.push("нет письменного задания");
  if (!all.some(({ block }) => block.type === "speaking")) gaps.push("нет устного задания");
  const tests = lessons.filter((lesson) => lesson.kind === "test");
  if (!tests.length) gaps.push("нет контрольной (урок с kind: test)");
  for (const test of tests)
    if (!test.blocks.some((block) => block.type === "exercise" && block.graded))
      gaps.push(`контрольная ${test.id}: нет оцениваемых заданий (graded: true)`);
  return gaps;
}

export function parseModule(input: unknown, path: string): CatalogModule {
  const raw = obj(input, path);
  const status = oneOf(raw.status, ["draft", "published"] as const, `${path}.status`);
  const lessonIds = list(raw.lessonIds ?? [], `${path}.lessonIds`).map((value, i) =>
    str(value, `${path}.lessonIds[${i}]`),
  );
  if (status === "draft" && lessonIds.length)
    throw new ContentError(`${path}.lessonIds: уроки черновика не поставляются`);
  if (status === "published" && !lessonIds.length)
    throw new ContentError(`${path}.lessonIds: у опубликованного модуля нет уроков`);
  return {
    id: id(raw.id, `${path}.id`),
    courseId: str(raw.courseId, `${path}.courseId`),
    number: int(raw.number, `${path}.number`, 1),
    title: str(raw.title, `${path}.title`),
    subtitle: str(raw.subtitle, `${path}.subtitle`),
    status,
    goal: str(raw.goal, `${path}.goal`),
    grammar: strings(raw.grammar ?? [], `${path}.grammar`, false),
    sessions: int(raw.sessions, `${path}.sessions`, 1),
    lessonIds,
  };
}
