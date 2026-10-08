// Расширения `.ts` обязательны: модуль загружает и Node при сборке контента.
export const LANGUAGES = ["el", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

export interface LanguageProfile {
  code: Language;
  /** Язык синтеза речи и записей. */
  voice: string;
  script: RegExp;
  /** Необязательный знак в конце ответа. */
  ending: RegExp;
  /** Артикль в начале ответа-слова: пропущенный или неверный — «почти». */
  article: RegExp | null;
  /** Слоги и ударение: сборка из слогов и строка ударения на карточке. */
  syllables: boolean;
  /** Буквы вариантов ответа (`list-style-type`). */
  letters: string;
  /** Дата на странице тетради. */
  date: { locale: string; upper: boolean };
  /** Подписи в интерфейсе: «Напиши по-гречески», «Поиск по греческому». */
  names: { in: string; by: string; title: string };
  almost: { message: string; article: string };
}

const el: LanguageProfile = {
  code: "el",
  voice: "el-GR",
  script: /\p{Script=Greek}/u,
  ending: /\s*[.!;;?…]+$/u,
  article: /^(ο|η|το|οι|τα|τον|την|τους|τις)\s+/u,
  syllables: true,
  letters: "lower-greek",
  date: { locale: "el-GR", upper: true },
  names: { in: "по-гречески", by: "по греческому", title: "Греческий" },
  almost: { message: "Почти! Проверь ударение.", article: "Почти! Проверь артикль и ударение." },
};

const en: LanguageProfile = {
  code: "en",
  voice: "en-GB",
  script: /\p{Script=Latin}/u,
  ending: /\s*[.!?…]+$/u,
  article: /^(a|an|the)\s+/u,
  syllables: false,
  letters: "lower-latin",
  date: { locale: "en-GB", upper: false },
  names: { in: "по-английски", by: "по английскому", title: "Английский" },
  almost: { message: "Почти! Проверь написание.", article: "Почти! Проверь артикль." },
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
export const anyVoice = (voices: Voices) => (typeof voices === "function" ? LANGUAGES.some(voices) : voices);
