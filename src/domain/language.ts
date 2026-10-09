// Расширения `.ts` обязательны: модуль загружает и Node при сборке контента.
export const LANGUAGES = ["el", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

export interface LanguageProfile {
  code: Language;
  /** Язык синтеза речи и записей. */
  voice: string;
  /** «нет греческого голоса». */
  voiceName: string;
  script: RegExp;
  /** Необязательный знак в конце ответа. */
  ending: RegExp;
  /** Артикль в начале ответа-слова: пропущенный или неверный — «почти». */
  article: RegExp | null;
  /** Слоги и ударение: сборка из слогов и строка ударения на карточке. */
  syllables: boolean;
  /** Буквы вариантов ответа: стиль счётчика и те же буквы для текста «Верно: β) …». */
  letters: { style: string; chars: readonly string[] };
  /** Дата на странице тетради. */
  date: { locale: string; upper: boolean };
  /** Подписи в интерфейсе: «Напиши по-гречески», «Поиск по греческому». */
  names: { in: string; by: string; title: string };
  /** Подписи наклейки на обложке модуля. */
  cover: { lesson: string; name: string };
  /** «Почти»: подсказка после ответа, что проверить в упражнении и пометка в итоге урока. */
  almost: { message: string; article: string; check: string; mark: string };
  /** Ответ после регистра и пробелов — к виду для сравнения. */
  canonical: (text: string) => string;
  /** Ответ не совпал, но засчитывается как «почти». */
  isAlmost: (given: string, accepted: string) => boolean;
}

/** Снимается только знак ударения (U+0301); диерезис (U+0308) сохраняется. */
export const stripAccent = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\u0301/g, "")
    .normalize("NFC");

/** Сокращения пишутся и полностью: `don't` = `do not`; `'s` и `'d` неоднозначны и не раскрываются. */
const expand = (value: string) =>
  value
    .replace(/\bcan't\b/g, "cannot")
    .replace(/\bwon't\b/g, "will not")
    .replace(/\bshan't\b/g, "shall not")
    .replace(/n't\b/g, " not")
    .replace(/'m\b/g, " am")
    .replace(/'re\b/g, " are")
    .replace(/'ve\b/g, " have")
    .replace(/'ll\b/g, " will")
    .replace(/\bcan not\b/g, "cannot");

const distance = (a: string, b: string) => {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
};
/** Опечатка — одна буква в одном слове, и только в слове от пяти букв: в коротком это уже другое слово. */
const typo = (given: string, accepted: string) => {
  const a = given.split(" "),
    b = accepted.split(" ");
  if (a.length !== b.length) return false;
  const differ = b.flatMap((word, index) => (word === a[index] ? [] : [index]));
  return differ.length === 1 && [...b[differ[0]]].length >= 5 && distance(a[differ[0]], b[differ[0]]) === 1;
};

const GREEK_ENDING = /\s*[.!;\u037e?…]+$/u;
const el: LanguageProfile = {
  code: "el",
  voice: "el-GR",
  voiceName: "греческого голоса",
  script: /\p{Script=Greek}/u,
  ending: GREEK_ENDING,
  article: /^(ο|η|το|οι|τα|τον|την|τους|τις)\s+/u,
  syllables: true,
  letters: { style: "lower-greek", chars: ["α", "β", "γ", "δ", "ε", "ζ"] },
  date: { locale: "el-GR", upper: true },
  names: { in: "по-гречески", by: "по греческому", title: "Греческий" },
  cover: { lesson: "ΜΑΘΗΜΑ", name: "ΟΝΟΜΑ" },
  almost: {
    message: "Почти! Проверь ударение.",
    article: "Почти! Проверь артикль и ударение.",
    check: "ударение",
    mark: "без ударения",
  },
  canonical: (text) => text.replace(GREEK_ENDING, ""),
  isAlmost: (given, accepted) => stripAccent(given) === stripAccent(accepted),
};

const ENGLISH_ENDING = /\s*[.!?…]+$/u;
const en: LanguageProfile = {
  code: "en",
  voice: "en-GB",
  voiceName: "английского голоса",
  script: /\p{Script=Latin}/u,
  ending: ENGLISH_ENDING,
  article: /^(a|an|the)\s+/u,
  syllables: false,
  letters: { style: "lower-latin", chars: ["a", "b", "c", "d", "e", "f"] },
  date: { locale: "en-GB", upper: false },
  names: { in: "по-английски", by: "по английскому", title: "Английский" },
  cover: { lesson: "LESSON", name: "NAME" },
  almost: {
    message: "Почти! Проверь написание.",
    article: "Почти! Проверь артикль.",
    check: "написание",
    mark: "с опечаткой",
  },
  canonical: (text) => expand(text.replace(ENGLISH_ENDING, "")),
  isAlmost: typo,
};

export const PROFILES: Record<Language, LanguageProfile> = { el, en };
export const DEFAULT_LANGUAGE: Language = "el";
export const profileOf = (language: string | undefined): LanguageProfile => {
  const code = language ?? DEFAULT_LANGUAGE;
  if (!isLanguage(code)) throw new Error(`Нет профиля языка «${code}»`);
  return PROFILES[code];
};

/**
 * Язык карточки по её письменности: карточки пока не знают свой курс. Хватает, пока у курсов разные
 * письменности; два курса на одной письменности потребуют курс у карточки.
 */
export const languageOfText = (text: string): LanguageProfile =>
  LANGUAGES.map((code) => PROFILES[code]).find((profile) => profile.script.test(text)) ?? PROFILES[DEFAULT_LANGUAGE];

/** Голос устройства: один на все языки (тесты, сервер) или по языку. */
export type Voices = boolean | ((language: Language) => boolean);
export const voiceFor = (voices: Voices, language: Language) =>
  typeof voices === "function" ? voices(language) : voices;
