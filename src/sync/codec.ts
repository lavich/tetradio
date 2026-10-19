import { deflateSync, inflateSync } from "fflate";
import type { SkillSummary, StatsSummary, StoredType, TypeSkill } from "../domain/skills";
import { KINDS, kindOfCode } from "../domain/kinds";
import { FOREIGN_TYPE, TYPE_CODE, typeOfCode } from "../domain/type-codes";
import { isForeign, parseStoredKey, storedKey } from "../domain/refs";
import type { ExerciseType, StoredRef } from "../domain/types";
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
 * С формата 5 незнакомые коды вида и типа проверки читаются как непрозрачные и записываются обратно теми же;
 * в форматах 3–4 они отбрасываются, как раньше.
 */
const encodeType = (type: StoredType) =>
  type.startsWith(FOREIGN_TYPE) ? type.slice(FOREIGN_TYPE.length) : TYPE_CODE[type as ExerciseType];
/** `null` — незнакомый код в формате, который его не сохраняет. */
const decodeType = (code: string, format: number): StoredType | null =>
  typeOfCode(code) ?? (format >= 5 ? `${FOREIGN_TYPE}${code}` : null);
/** Коды снятых видов: их карточек нет и не будет, такие ссылки отбрасываются в любом формате. */
const RETIRED_KINDS = new Set(["c"]);
const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : 0);
const iso = (value: number) => new Date(value).toISOString();
const bits = (recent: boolean[]) => recent.map((flag) => (flag ? "1" : "0")).join("");
const unbits = (text: string) => [...text].map((char) => char === "1");
/**
 * Коды видов — из перечня видов. Код `c` принадлежал снятому виду и SHALL NOT переиспользоваться:
 * снимки старых клиентов продолжают его содержать.
 */
export const encodeRef = (ref: StoredRef) => `${isForeign(ref) ? ref.code : KINDS[ref.kind].code}${ref.id}`;
/**
 * Ссылка незнакомого вида с формата 5 — непрозрачная `ForeignRef`. В форматах 3–4 это ссылка снятого вида
 * из снимка старого клиента: `null`, её прогресс отбрасывается молча. Пустая ссылка — повреждённый снимок.
 */
export function decodeRef(wire: string, format: number = SNAPSHOT_FORMAT): StoredRef | null {
  if (wire.length < 2) throw new SnapshotFormatError(`Некорректная ссылка на карточку: ${wire}`);
  const code = wire[0];
  const id = wire.slice(1);
  const kind = kindOfCode(code);
  if (kind) return { kind, id };
  return format >= 5 && !RETIRED_KINDS.has(code) ? { code, id } : null;
}
/** `null` — ключ снятого вида: кода для него нет, а срывать из-за одного такого ключа публикацию нельзя. */
const encodeKey = (key: string): string | null => {
  const ref = parseStoredKey(key);
  return ref && encodeRef(ref);
};
const decodeKey = (wire: string, format: number) => {
  const ref = decodeRef(wire, format);
  return ref && storedKey(ref);
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
const decodeState = (wire: WireState, format: number): CompactState | null => {
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
  const target = decodeRef(raw, format);
  return target && { ref: target, card, introducedAt: iso(intro), version };
};
const encodeSkill = (ref: StoredRef, skills: SkillSummary): WireSkill => [
  encodeRef(ref),
  skills.lastTypes.map(encodeType).join(""),
  skills.cleanAssemblies,
  Object.fromEntries(
    Object.entries(skills.types)
      .filter((entry): entry is [StoredType, TypeSkill] => !!entry[1])
      .map(([type, skill]) => [encodeType(type), [bits(skill.recent), ms(skill.lastAt)]]),
  ),
];
const decodeSkill = (wire: WireSkill, format: number): { ref: StoredRef; skills: SkillSummary } | null => {
  const [raw, last, cleanAssemblies, types] = wire;
  const target = decodeRef(raw, format);
  return (
    target && {
      ref: target,
      skills: {
        lastTypes: [...last].map((code) => decodeType(code, format)).filter(alive),
        cleanAssemblies,
        types: Object.fromEntries(
          Object.entries(types).flatMap(([code, [recent, at]]) => {
            const type = decodeType(code, format);
            return type ? [[type, { recent: unbits(recent), lastAt: iso(at) }]] : [];
          }),
        ),
      },
    }
  );
};
const encodeStats = (stats: StatsSummary): Wire["x"] => ({
  d: stats.days.map((day) => [day.date, day.answers, day.keys.map(encodeKey).filter(alive)]),
  r: Object.fromEntries(
    Object.entries(stats.recentByType)
      .filter((entry): entry is [StoredType, boolean[]] => !!entry[1])
      .map(([type, recent]) => [encodeType(type), bits(recent)]),
  ),
  n: stats.answers,
  w: stats.answeredKeys.map(encodeKey).filter(alive),
});
const decodeStats = (wire: Wire["x"], format: number): StatsSummary => ({
  days: wire.d.map(([date, answers, keys]) => ({
    date,
    answers,
    keys: keys.map((key) => decodeKey(key, format)).filter(alive),
  })),
  recentByType: Object.fromEntries(
    Object.entries(wire.r).flatMap(([code, recent]) => {
      const type = decodeType(code, format);
      return type ? [[type, unbits(recent)]] : [];
    }),
  ),
  answers: wire.n,
  answeredKeys: wire.w.map((key) => decodeKey(key, format)).filter(alive),
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
/** Ключи и состояния, которые формат снимка не сохраняет, выпадают из него. */
const alive = <T>(value: T | null): value is T => value !== null;

export function encodeSnapshot(snapshot: CompactSnapshot, format: number = snapshot.format): string {
  const wire: Wire = {
    f: format,
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
/**
 * Бросает `SnapshotFormatError` при неподдерживаемой версии формата или неверной структуре; повреждённый JSON
 * и формат, не совпавший с `expectedFormat`, — обычная ошибка.
 */
export function decodeSnapshot(text: string, expectedFormat?: number): CompactSnapshot {
  const wire = JSON.parse(text) as Wire;
  if (expectedFormat !== undefined && wire?.f !== expectedFormat)
    throw new Error(`Формат снимка ${String(wire?.f)} не совпадает с форматом версии ${expectedFormat}`);
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
    states: wire.st.map((state) => decodeState(state, wire.f)).filter(alive),
    skills: wire.sk.map((skill) => decodeSkill(skill, wire.f)).filter(alive),
    stats: decodeStats(wire.x, wire.f),
  };
}

const BASE64_CHUNK = 0x8000;
const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  // Порциями: spread всего массива в String.fromCharCode переполняет стек на снимке в сотни килобайт.
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK)
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK));
  return btoa(binary);
};
const fromBase64 = (text: string) => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};
/** Формат 6: JSON снимка → UTF-8 → raw deflate → base64, чтобы каждое значение CloudStorage было ASCII. */
export const packSnapshot = (json: string) => toBase64(deflateSync(new TextEncoder().encode(json)));
export const unpackSnapshot = (text: string) =>
  new TextDecoder("utf-8", { fatal: true }).decode(inflateSync(fromBase64(text)));
