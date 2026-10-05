import type { SkillSummary, StatsSummary, TypeSkill } from "../domain/skills";
import { tryParseUnitKey, unitKey } from "../domain/refs";
import type { CardKind, ExerciseType, LearningRef } from "../domain/types";
import {
  SNAPSHOT_FORMAT,
  SUPPORTED_SNAPSHOT_FORMATS,
  type CompactBlock,
  type CompactLesson,
  type CompactSnapshot,
  type CompactState,
  type SerializedCard,
} from "./types";

/**
 * Проводной формат снимка: массивы вместо объектов, миллисекунды вместо ISO, исходы ответов — битовой строкой.
 * Числа FSRS не округляются: второе устройство должно получить те же интервалы. Кодек обратим, что проверяется тестом.
 * Ссылка на карточку — символ вида и идентификатор. `b` — блоки курса, сгруппированные по уроку:
 * `[урок, [[блок, выполнен 0|1, мс, счёт|0, критерии?]…]]`. Формат 4: курс — `[id, предел]`, урок — `[id, пройден 0|1, мс]`;
 * формат 3 нёс курс объектом с расписанием и урок — `[id, дата, статус, мс]`.
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
type WireLesson = [string, 0 | 1, number];
type Format3Lesson = [string, string | null, "upcoming" | "completed", number];
type WireBlock =
  | [string, 0 | 1, number]
  | [string, 0 | 1, number, [number, number, number] | 0]
  | [string, 0 | 1, number, [number, number, number] | 0, number[]];
type WireLessonBlocks = [string, WireBlock[]];
interface Wire {
  f: number;
  c: number;
  /**
   * Настройки и курсы прежних версий (часовой пояс, размер занятия, дневной предел) сняты. Поля остаются пустыми:
   * версии, ещё закэшированные у пользователей, проверяют их наличие и применяют содержимое поверх своего.
   */
  s: Record<string, never>;
  cs: [];
  l: WireLesson[] | Format3Lesson[];
  p: string[];
  b: WireLessonBlocks[];
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
const decodeState = (wire: WireState): CompactState | null => {
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
  const target = decodeRef(raw);
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
const decodeSkill = (wire: WireSkill): { ref: LearningRef; skills: SkillSummary } | null => {
  const [raw, last, cleanAssemblies, types] = wire;
  const target = decodeRef(raw);
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
const decodeStats = (wire: Wire["x"]): StatsSummary => ({
  days: wire.d.map(([date, answers, keys]) => ({ date, answers, keys: keys.map(decodeKey).filter(alive) })),
  recentByType: Object.fromEntries(Object.entries(wire.r).map(([code, recent]) => [CODE_TYPE[code], unbits(recent)])),
  answers: wire.n,
  answeredKeys: wire.w.map(decodeKey).filter(alive),
});
const encodeBlocks = (blocks: CompactBlock[]): WireLessonBlocks[] => {
  const byLesson = new Map<string, WireBlock[]>();
  for (const block of blocks) {
    const score = block.score ? ([block.score.correct, block.score.almost, block.score.total] as const) : 0;
    const head = [block.blockId, block.done ? 1 : 0, ms(block.updatedAt)] as const;
    const row: WireBlock = block.checks?.length
      ? [...head, score ? [...score] : 0, block.checks]
      : score
        ? [...head, [...score]]
        : [...head];
    const rows = byLesson.get(block.lessonId);
    if (rows) rows.push(row);
    else byLesson.set(block.lessonId, [row]);
  }
  return [...byLesson];
};
const decodeBlocks = (wire: unknown): CompactBlock[] => {
  if (!Array.isArray(wire)) throw new SnapshotFormatError("Структура блоков курса не соответствует формату");
  return (wire as WireLessonBlocks[]).flatMap(([lessonId, rows]) => {
    if (typeof lessonId !== "string" || !Array.isArray(rows))
      throw new SnapshotFormatError("Структура блоков курса не соответствует формату");
    return rows.map(([blockId, done, updated, score, checks]): CompactBlock => {
      if (typeof blockId !== "string" || typeof updated !== "number")
        throw new SnapshotFormatError("Структура блока курса не соответствует формату");
      return {
        lessonId,
        blockId,
        done: done === 1,
        ...(Array.isArray(score) ? { score: { correct: score[0], almost: score[1], total: score[2] } } : {}),
        ...(Array.isArray(checks) && checks.length ? { checks } : {}),
        updatedAt: iso(updated),
      };
    });
  });
};
/** Ключи и состояния снятых видов выпадают из снимка: карточки под ними нет и не будет. */
const alive = <T>(value: T | null): value is T => value !== null;

export function encodeSnapshot(snapshot: CompactSnapshot): string {
  const wire: Wire = {
    f: snapshot.format,
    c: ms(snapshot.createdAt),
    s: {},
    cs: [],
    l: snapshot.lessons.map((lesson): WireLesson => [lesson.id, lesson.completed ? 1 : 0, ms(lesson.updatedAt)]),
    p: snapshot.packages,
    b: encodeBlocks(snapshot.blocks),
    st: snapshot.states.map(encodeState),
    sk: snapshot.skills.map((entry) => encodeSkill(entry.ref, entry.skills)),
    x: encodeStats(snapshot.stats),
  };
  return JSON.stringify(wire);
}
export class SnapshotFormatError extends Error {}
const decodeLessons = (wire: Wire): CompactLesson[] =>
  wire.f === 3
    ? (wire.l as Format3Lesson[]).map(([id, , status, at]) => ({
        id,
        completed: status === "completed",
        updatedAt: iso(at),
      }))
    : (wire.l as WireLesson[]).map(([id, completed, at]) => ({ id, completed: completed === 1, updatedAt: iso(at) }));
/** Бросает `SnapshotFormatError` при неподдерживаемой версии формата или неверной структуре; повреждённый JSON — обычная ошибка разбора. */
export function decodeSnapshot(text: string): CompactSnapshot {
  const wire = JSON.parse(text) as Wire;
  if (!(SUPPORTED_SNAPSHOT_FORMATS as readonly unknown[]).includes(wire?.f))
    throw new SnapshotFormatError(`Формат снимка ${String(wire?.f)} не поддерживается`);
  if (
    !Array.isArray(wire.st) ||
    !Array.isArray(wire.sk) ||
    !wire.s ||
    !wire.x ||
    !Array.isArray(wire.l) ||
    !Array.isArray(wire.p) ||
    !Array.isArray(wire.cs)
  )
    throw new SnapshotFormatError("Структура снимка не соответствует формату");
  return {
    format: SNAPSHOT_FORMAT,
    createdAt: iso(wire.c ?? 0),
    lessons: decodeLessons(wire),
    packages: wire.p,
    blocks: decodeBlocks(wire.b),
    states: wire.st.map(decodeState).filter(alive),
    skills: wire.sk.map(decodeSkill).filter(alive),
    stats: decodeStats(wire.x),
  };
}
