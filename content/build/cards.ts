import { phraseKey, wordKey } from "../../src/domain/refs.ts";
import {
  ContentError,
  PHRASE_FIELDS,
  SHIPPED_FIELDS,
  validatePhrase,
  type PackagePhrase,
  type PackageWord,
} from "../../src/content/schema.ts";
import type { Example, Gloss, Segment } from "../../src/domain/types.ts";
import { PROFILES, type Language } from "../../src/domain/language.ts";
import { canonical, fail, hash, LANGUAGE, nfc, pick, text } from "./common.ts";
import type { ContentRoot, PhraseSource, Sourced, WordSource } from "./sources.ts";

export const imageAssetId = (wordId: string) => `img-${wordId}`;
export const audioAssetId = (wordId: string) => `snd-${wordId}`;
export const revisionOf = (word: Omit<PackageWord, "revision">) => hash(canonical(pick(word, SHIPPED_FIELDS)));
export const phraseRevisionOf = (phrase: Omit<PackagePhrase, "revision">) =>
  hash(canonical(pick(phrase, PHRASE_FIELDS)));

const checkId = (id: string, where: string) => {
  if (!/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(id))
    fail(`${where}: идентификатор «${id}» — буквы, цифры и дефис без пробелов`);
};

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

function describe(id: string, src: Sourced<WordSource>, language: Language, picture = false): PackageWord {
  const where = `words/${src.file}`;
  checkId(id, where);
  const greek = text(src.greek, `${where}.greek`)!,
    russian = text(src.russian, `${where}.russian`)!;
  if (!PROFILES[language].script.test(greek)) fail(`${where}: нет букв языка курса (${language})`);
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
  const forms = text(src.forms, `${where}.forms`, false);
  if (forms) draft.forms = forms;
  if (source) draft.source = source;
  if (src.image || picture) draft.imageAssetId = imageAssetId(id);
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

/**
 * Одно и то же слово живёт в одном файле и получает один идентификатор во всех уроках.
 * Два файла с одинаковой парой «написание + перевод» — ошибка публикации, а не тихий дубликат.
 * Для фраз дубликат — тот же текст и перевод.
 */
export function buildCards(sources: ContentRoot, languages: Map<string, Language>) {
  const words = new Map<string, PackageWord>();
  const byKey = new Map<string, string>();
  for (const [picturedId] of sources.pictures.words)
    if (!sources.words.has(picturedId)) fail(`pictures.yaml: слова ${picturedId} нет в words/`);
  for (const [id, src] of sources.words) {
    if (src.image && sources.pictures.words.has(id))
      fail(`words/${src.file}: у слова своя иллюстрация и картинка из pictures.yaml — оставьте одну`);
    const word = describe(id, src, languages.get(src.course) ?? LANGUAGE, sources.pictures.words.has(id));
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
  return { words, phrases };
}
