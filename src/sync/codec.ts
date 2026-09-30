import type { SkillSummary, StatsSummary, TypeSkill } from "../domain/skills";
import { tryParseUnitKey, unitKey, wordRef } from "../domain/refs";
import type { CardKind, ExerciseType, LearningRef } from "../domain/types";
import {
  LEGACY_SNAPSHOT_FORMAT,
  SNAPSHOT_FORMAT,
  type CompactCourse,
  type CompactSnapshot,
  type CompactState,
  type SerializedCard,
} from "./types";

/**
 * Проводной формат снимка: массивы вместо объектов, миллисекунды вместо ISO, исходы ответов — битовой строкой.
 * Числа FSRS не округляются: второе устройство должно получить те же интервалы. Кодек обратим, что проверяется тестом.
 * Формат 2 кодирует ссылку на карточку одним символом вида и идентификатором; формат 1 читается как словарный.
 */
const TYPE_CODE: Record<ExerciseType, string> = {
  recall: "c",
  recognition: "r",
  assembly: "a",
  spelling: "s",
  listening: "l",
  comprehension: "m",
  cloze: "z",
};
const CODE_TYPE = Object.fromEntries(Object.entries(TYPE_CODE).map(([type, code]) => [code, type])) as Record<
  string,
  ExerciseType
>;
/**
 * Коды видов карточек. Код `c` принадлежал снятому виду и SHALL NOT переиспользоваться:
 * снимки старых клиентов продолжают его содержать, а ссылку с неизвестным кодом читатель пропускает.
 */
const KIND_CODE: Record<CardKind, string> = { word: "w", phrase: "p" };
const CODE_KIND = Object.fromEntries(Object.entries(KIND_CODE).map(([kind, code]) => [code, kind])) as Record<
  string,
  CardKind
>;
const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : 0);
const iso = (value: number) => new Date(value).toISOString();
const bits = (recent: boolean[]) => recent.map((flag) => (flag ? "1" : "0")).join("");
const unbits = (text: string) => [...text].map((char) => char === "1");
export const encodeRef = (ref: LearningRef) => `${KIND_CODE[ref.kind]}${ref.id}`;
/**
 * `null` — ссылка на карточку снятого вида из снимка старого клиента: её прогресс отбрасывается молча,
 * иначе одна незнакомая ссылка отменила бы синхронизацию слов и фраз. Пустая ссылка — повреждённый снимок.
 */
export function decodeRef(wire: string): LearningRef | null {
  if (wire.length < 2) throw new SnapshotFormatError(`Некорректная ссылка на карточку: ${wire}`);
  const kind = CODE_KIND[wire[0]];
  return kind ? { kind, id: wire.slice(1) } : null;
}
/** `null` — ключ снятого вида: кода для него нет, а срывать из-за одного такого ключа публикацию нельзя. */
const encodeKey = (key: string): string | null => {
  const ref = tryParseUnitKey(key);
  return ref && encodeRef(ref);
};
const decodeKey = (wire: string) => {
  const ref = decodeRef(wire);
  return ref && unitKey(ref);
};

type WireState = [
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
type WireSkill = [string, string, number, Record<string, [string, number]>];
type WireDay = [string, number, string[]];
type WireCourse = { id: string; subscribed: boolean; newItemsPerDay: number; schedule: CompactCourse["schedule"] };
type LegacyWireCourse = {
  id: string;
  subscribed: boolean;
  newWordsPerDay: number;
  schedule: CompactCourse["schedule"];
};
interface Wire {
  f: number;
  c: number;
  s: CompactSnapshot["settings"];
  cs?: (WireCourse | LegacyWireCourse)[];
  l: [string, string | null, "upcoming" | "completed", number][];
  p: string[];
  st: WireState[];
  sk: WireSkill[];
  x: { d: WireDay[]; r: Record<string, string>; n: number; w: string[] };
}
const encodeState = (state: CompactState): WireState => {
  const card = state.card;
  return [
    encodeRef(state.ref),
    ms(card.due),
    card.stability,
    card.difficulty,
    card.elapsed_days,
    card.scheduled_days,
    card.reps,
    card.lapses,
    card.state,
    card.learning_steps ?? 0,
    ms(card.last_review),
    ms(state.introducedAt),
    state.version,
  ];
};
const decodeState = (wire: WireState, ref: (raw: string) => LearningRef | null): CompactState | null => {
  const [
    raw,
    due,
    stability,
    difficulty,
    elapsed_days,
    scheduled_days,
    reps,
    lapses,
    state,
    learning_steps,
    last,
    intro,
    version,
  ] = wire;
  const card: SerializedCard = {
    due: iso(due),
    stability,
    difficulty,
    elapsed_days,
    scheduled_days,
    reps,
    lapses,
    state,
    learning_steps,
    ...(last ? { last_review: iso(last) } : {}),
  };
  const target = ref(raw);
  return target && { ref: target, card, introducedAt: iso(intro), version };
};
const encodeSkill = (ref: LearningRef, skills: SkillSummary): WireSkill => [
  encodeRef(ref),
  skills.lastTypes.map((type) => TYPE_CODE[type]).join(""),
  skills.cleanAssemblies,
  Object.fromEntries(
    Object.entries(skills.types)
      .filter((entry): entry is [string, TypeSkill] => !!entry[1])
      .map(([type, skill]) => [TYPE_CODE[type as ExerciseType], [bits(skill.recent), ms(skill.lastAt)]]),
  ),
];
const decodeSkill = (
  wire: WireSkill,
  ref: (raw: string) => LearningRef | null,
): { ref: LearningRef; skills: SkillSummary } | null => {
  const [raw, last, cleanAssemblies, types] = wire;
  const target = ref(raw);
  return (
    target && {
      ref: target,
      skills: {
        lastTypes: [...last].map((code) => CODE_TYPE[code]).filter(Boolean),
        cleanAssemblies,
        types: Object.fromEntries(
          Object.entries(types).map(([code, [recent, at]]) => [
            CODE_TYPE[code],
            { recent: unbits(recent), lastAt: iso(at) },
          ]),
        ),
      },
    }
  );
};
const encodeStats = (stats: StatsSummary): Wire["x"] => ({
  d: stats.days.map((day) => [day.date, day.answers, day.keys.map(encodeKey).filter(alive)]),
  r: Object.fromEntries(
    Object.entries(stats.recentByType)
      .filter((entry): entry is [string, boolean[]] => !!entry[1])
      .map(([type, recent]) => [TYPE_CODE[type as ExerciseType], bits(recent)]),
  ),
  n: stats.answers,
  w: stats.answeredKeys.map(encodeKey).filter(alive),
});
const decodeStats = (wire: Wire["x"], key: (raw: string) => string | null): StatsSummary => ({
  days: wire.d.map(([date, answers, keys]) => ({ date, answers, keys: keys.map(key).filter(alive) })),
  recentByType: Object.fromEntries(Object.entries(wire.r).map(([code, recent]) => [CODE_TYPE[code], unbits(recent)])),
  answers: wire.n,
  answeredKeys: wire.w.map(key).filter(alive),
});
/** Ключи и состояния снятых видов выпадают из снимка: карточки под ними нет и не будет. */
const alive = <T>(value: T | null): value is T => value !== null;

export function encodeSnapshot(snapshot: CompactSnapshot): string {
  const wire: Wire = {
    f: snapshot.format,
    c: ms(snapshot.createdAt),
    s: snapshot.settings,
    cs: snapshot.courses,
    l: snapshot.lessons.map((lesson) => [lesson.id, lesson.targetDate, lesson.status, ms(lesson.updatedAt)]),
    p: snapshot.packages,
    st: snapshot.states.map(encodeState),
    sk: snapshot.skills.map((entry) => encodeSkill(entry.ref, entry.skills)),
    x: encodeStats(snapshot.stats),
  };
  return JSON.stringify(wire);
}
export class SnapshotFormatError extends Error {}
/**
 * Бросает `SnapshotFormatError` при неподдерживаемой версии формата или неверной структуре; повреждённый JSON — обычная ошибка разбора.
 * Снимок формата 1 читается как словарный: его идентификаторы становятся ссылками на слова с теми же сроками и счётчиками.
 */
export function decodeSnapshot(text: string): CompactSnapshot {
  const wire = JSON.parse(text) as Partial<Wire>;
  if (wire?.f !== SNAPSHOT_FORMAT && wire?.f !== LEGACY_SNAPSHOT_FORMAT)
    throw new SnapshotFormatError(`Формат снимка ${String(wire?.f)} не поддерживается`);
  if (
    !Array.isArray(wire.st) ||
    !Array.isArray(wire.sk) ||
    !wire.s ||
    !wire.x ||
    !Array.isArray(wire.l) ||
    !Array.isArray(wire.p)
  )
    throw new SnapshotFormatError("Структура снимка не соответствует формату");
  const legacy = wire.f === LEGACY_SNAPSHOT_FORMAT;
  const ref = legacy ? wordRef : decodeRef;
  const key = legacy ? (raw: string) => unitKey(wordRef(raw)) : decodeKey;
  const course = (raw: WireCourse | LegacyWireCourse): CompactCourse => ({
    id: raw.id,
    subscribed: raw.subscribed,
    schedule: raw.schedule,
    newItemsPerDay: "newItemsPerDay" in raw ? raw.newItemsPerDay : raw.newWordsPerDay,
  });
  return {
    format: SNAPSHOT_FORMAT,
    createdAt: iso(wire.c ?? 0),
    settings: wire.s,
    // Снимок прежнего формата курсов не знает: пустой список означает «не трогать локальные».
    courses: (wire.cs ?? []).map(course),
    lessons: wire.l.map(([id, targetDate, status, updatedAt]) => ({
      id,
      targetDate,
      status,
      updatedAt: iso(updatedAt),
    })),
    packages: wire.p,
    states: wire.st.map((state) => decodeState(state, ref)).filter(alive),
    skills: wire.sk.map((skill) => decodeSkill(skill, ref)).filter(alive),
    stats: decodeStats(wire.x, key),
  };
}
