import { mergeReviewDays } from "../domain/review-days";
import { isForeign, storedKey } from "../domain/refs";
import type { DaySummary, SkillSummary, StatsSummary, StoredType, TypeSkill } from "../domain/skills";
import type { StoredRef } from "../domain/types";
import { decodeSnapshot, encodeSnapshot } from "./codec";
import {
  SNAPSHOT_FORMAT,
  type CompactBlock,
  type CompactLesson,
  type CompactSnapshot,
  type CompactState,
} from "./types";

/** Ветвь слияния: снимок и формат, которым он пришёл (от него зависит, что отсутствие значения считается удалением). */
export interface MergeInput {
  snapshot: CompactSnapshot;
  format: number;
}
/** Окно дней статистики, как в сводке снимка. */
const KEEP_DAYS = 14;

/** Снимки сравниваются после кодека: умолчания проводного формата не должны выглядеть изменением. */
export const normalize = (snapshot: CompactSnapshot): CompactSnapshot =>
  decodeSnapshot(encodeSnapshot(snapshot, SNAPSHOT_FORMAT), SNAPSHOT_FORMAT);

const text = (value: unknown) => JSON.stringify(value) ?? "";
const same = (a: unknown, b: unknown) => text(a) === text(b);
/** Ничья разбивается по содержанию, а не по ветви: id одной ветви на разных устройствах разный. */
const byContent = <T>(values: T[]) => values.reduce((best, value) => (text(value) > text(best) ? value : best));
const later = (a: string | undefined, b: string | undefined) => (a ?? "") > (b ?? "");

/**
 * Значения одного ключа: у предка и у каждой ветви (`undefined` — нет). Изменили ли ветви значение, решает сравнение с
 * предком; если все изменившие пришли к одному, это оно; иначе — правило поля. `keeps` — ветвь не выражает отсутствие
 * этого ключа (старый формат или поле, отсутствие которого не означает удаления): для неё оно «без изменений».
 */
function mergeKey<T>(
  base: T | undefined,
  values: (T | undefined)[],
  keeps: boolean[],
  resolve: (changed: T[], base: T | undefined) => T,
): T | undefined {
  const before = text(base);
  const changed: { value: T | undefined; json: string }[] = [];
  values.forEach((value, index) => {
    if (value === undefined && keeps[index]) return;
    const json = text(value);
    if (json !== before) changed.push({ value, json });
  });
  if (!changed.length) return base;
  if (changed.every((entry) => entry.json === changed[0].json)) return changed[0].value;
  // Удалённое одной стороной и изменённое другой остаётся изменённым.
  const present = changed.flatMap((entry) => (entry.value === undefined ? [] : [entry.value]));
  return present.length === 1 ? present[0] : resolve(present, base);
}
function mergeMaps<T>(
  base: Map<string, T>,
  branches: Map<string, T>[],
  keeps: (key: string, branch: number) => boolean,
  resolve: (changed: T[], base: T | undefined) => T,
): Map<string, T> {
  const keys = new Set([...base.keys(), ...branches.flatMap((branch) => [...branch.keys()])]);
  const merged = new Map<string, T>();
  for (const key of [...keys].sort()) {
    const value = mergeKey(
      base.get(key),
      branches.map((branch) => branch.get(key)),
      branches.map((_, index) => keeps(key, index)),
      resolve,
    );
    if (value !== undefined) merged.set(key, value);
  }
  return merged;
}
const keyed = <T>(items: T[], key: (item: T) => string) => new Map(items.map((item) => [key(item), item]));
const blockId = (block: CompactBlock) => `${block.lessonId}\u0000${block.blockId}`;

const mergeState = (changed: CompactState[]): CompactState => {
  const latest = changed.reduce((best, state) =>
    later(state.card.last_review, best.card.last_review) ||
    (state.card.last_review === best.card.last_review && text(state) > text(best))
      ? state
      : best,
  );
  return {
    ...latest,
    introducedAt: changed.map((state) => state.introducedAt).reduce((a, b) => (b < a ? b : a)),
    version: Math.max(...changed.map((state) => state.version)) + 1,
  };
};
const mergeLesson = (changed: CompactLesson[]): CompactLesson => ({
  id: changed[0].id,
  completed: changed.some((lesson) => lesson.completed),
  updatedAt: changed.map((lesson) => lesson.updatedAt).reduce((a, b) => (b > a ? b : a)),
});
/** Блок целиком с более поздним изменением: «Повторить» (`done: false`, без счёта) не смешивается с чужим счётом. */
const mergeBlock = (changed: CompactBlock[]): CompactBlock =>
  byContent(changed.filter((block) => !changed.some((other) => later(other.updatedAt, block.updatedAt))));

const lastAnswerAt = (skills: SkillSummary) =>
  Object.values(skills.types).reduce<string>(
    (latest, type) => (type && type.lastAt > latest ? type.lastAt : latest),
    "",
  );
/** Сколько последних исходов у ветви появилось после предка: самый короткий хвост, при котором начало совпадает с концом предка. */
const freshOutcomes = (base: TypeSkill | undefined, branch: TypeSkill) => {
  if (!base || branch.lastAt <= base.lastAt) return branch.lastAt === base?.lastAt ? 0 : branch.recent.length;
  for (let fresh = 1; fresh <= branch.recent.length; fresh++) {
    const kept = branch.recent.slice(0, branch.recent.length - fresh);
    if (same(kept, base.recent.slice(base.recent.length - kept.length))) return fresh;
  }
  return branch.recent.length;
};
/**
 * Чистые сборки — «после последней ошибки в написании»: ошибка сбрасывает счёт. Ветвь со сбросом после предка задаёт
 * счёт (поздний сброс главнее); без сбросов приросты складываются.
 */
function mergeCleanAssemblies(base: SkillSummary | undefined, changed: SkillSummary[]): number {
  const before = base?.cleanAssemblies ?? 0;
  const resets = changed.filter((skills) => {
    const spelling = skills.types.spelling;
    if (!spelling) return false;
    const fresh = freshOutcomes(base?.types.spelling, spelling);
    return fresh > 0 && spelling.recent.slice(-fresh).includes(false);
  });
  if (resets.length)
    return resets.reduce((best, skills) =>
      later(skills.types.spelling?.lastAt, best.types.spelling?.lastAt) ? skills : best,
    ).cleanAssemblies;
  return Math.max(0, before + changed.reduce((sum, skills) => sum + skills.cleanAssemblies - before, 0));
}
function mergeSkills(changed: SkillSummary[], base: SkillSummary | undefined): SkillSummary {
  const typeNames = new Set(changed.flatMap((skills) => Object.keys(skills.types))) as Set<StoredType>;
  const types: SkillSummary["types"] = {};
  for (const type of [...typeNames].sort()) {
    const candidates = changed
      .map((skills) => skills.types[type])
      .filter((value): value is TypeSkill => !!value && !same(value, base?.types[type]));
    const value = candidates.length
      ? candidates.reduce((best, item) =>
          later(item.lastAt, best.lastAt) || (item.lastAt === best.lastAt && text(item) > text(best)) ? item : best,
        )
      : (base?.types[type] ?? changed.map((skills) => skills.types[type]).find((item) => !!item));
    if (value) types[type] = value;
  }
  const latest = changed.reduce((best, skills) =>
    later(lastAnswerAt(skills), lastAnswerAt(best)) ||
    (lastAnswerAt(skills) === lastAnswerAt(best) && text(skills.lastTypes) > text(best.lastTypes))
      ? skills
      : best,
  );
  return { types, lastTypes: latest.lastTypes, cleanAssemblies: mergeCleanAssemblies(base, changed) };
}

/** Приросты ветвей к предку складываются: `Σ(Xᵢ − A) + A`, не ниже нуля. */
const growth = (base: number, values: number[]) =>
  Math.max(0, base + values.reduce((sum, value) => sum + value - base, 0));
function mergeStats(
  base: StatsSummary,
  branches: StatsSummary[],
  skills: { ref: StoredRef; skills: SkillSummary }[][],
) {
  // Ветви после предка не делят историю: одинаковые приросты двух сторон — разные ответы, они складываются.
  const changed = branches.filter((stats) => !same(stats, base));
  if (!changed.length) return base;
  if (changed.length === 1) return changed[0];
  const dates = new Set([...base.days, ...branches.flatMap((stats) => stats.days)].map((day) => day.date));
  const days: DaySummary[] = [];
  for (const date of [...dates].sort()) {
    const before = base.days.find((day) => day.date === date);
    // Дня у ветви нет — он выпал за окно или она в этот день не отвечала: это не удаление.
    const seen = branches.map((stats) => stats.days.find((day) => day.date === date) ?? before);
    const values = seen.filter((day): day is DaySummary => !!day);
    days.push({
      date,
      answers: growth(
        before?.answers ?? 0,
        seen.map((day) => day?.answers ?? before?.answers ?? 0),
      ),
      keys: [...new Set(values.flatMap((day) => day.keys))].sort(),
    });
  }
  const types = new Set([base, ...branches].flatMap((stats) => Object.keys(stats.recentByType))) as Set<StoredType>;
  const recentByType: StatsSummary["recentByType"] = {};
  for (const type of [...types].sort()) {
    const changed = branches
      .map((stats, index) => ({ recent: stats.recentByType[type], at: lastOfType(skills[index], type) }))
      .filter((entry) => entry.recent && !same(entry.recent, base.recentByType[type]));
    const value = changed.length
      ? changed.reduce((best, entry) =>
          later(entry.at, best.at) || (entry.at === best.at && text(entry.recent) > text(best.recent)) ? entry : best,
        ).recent
      : base.recentByType[type];
    if (value) recentByType[type] = value;
  }
  return {
    days: days.filter((day) => day.answers > 0 || day.keys.length).slice(-KEEP_DAYS),
    recentByType,
    answers: growth(
      base.answers,
      branches.map((stats) => stats.answers),
    ),
    answeredKeys: [...new Set([...base.answeredKeys, ...branches.flatMap((stats) => stats.answeredKeys)])].sort(),
  };
}
const lastOfType = (skills: { skills: SkillSummary }[], type: StoredType) =>
  skills.reduce((latest, entry) => {
    const at = entry.skills.types[type]?.lastAt ?? "";
    return at > latest ? at : latest;
  }, "");

/**
 * Трёхстороннее слияние: предок и ветви, которые от него происходят и после него не делят историю. Чистая функция,
 * симметричная по порядку ветвей. Снимки — нормализованные кодеком (`normalize`).
 */
export function mergeSnapshots(ancestor: MergeInput, branches: MergeInput[], createdAt: string): CompactSnapshot {
  const base = ancestor.snapshot;
  const snapshots = branches.map((branch) => branch.snapshot);
  // Формат 3/4 не выражает карточки незнакомых видов: их отсутствие в такой ветви — не удаление.
  const statesKeep = (key: string, index: number) =>
    branches[index].format < 5 && isForeign(stateRef(key, base, snapshots));
  const states = mergeMaps(
    keyed(base.states, (state) => storedKey(state.ref)),
    snapshots.map((snapshot) => keyed(snapshot.states, (state) => storedKey(state.ref))),
    statesKeep,
    (changed) => mergeState(changed),
  );
  // Урок или блок перечисляет устройство, где он установлен или выполнялся: отсутствие — не удаление.
  const lessons = mergeMaps(
    keyed(base.lessons, (lesson) => lesson.id),
    snapshots.map((snapshot) => keyed(snapshot.lessons, (lesson) => lesson.id)),
    () => true,
    (changed) => mergeLesson(changed),
  );
  const blocks = mergeMaps(
    keyed(base.blocks, blockId),
    snapshots.map((snapshot) => keyed(snapshot.blocks, blockId)),
    () => true,
    (changed) => mergeBlock(changed),
  );
  const skills = mergeMaps(
    keyed(base.skills, (entry) => storedKey(entry.ref)),
    snapshots.map((snapshot) => keyed(snapshot.skills, (entry) => storedKey(entry.ref))),
    () => true,
    (changed, before) => ({
      ref: changed[0].ref,
      skills: mergeSkills(
        changed.map((entry) => entry.skills),
        before?.skills,
      ),
    }),
  );
  const reviewDays = mergeReviewDays(base.reviewDays, ...snapshots.map((snapshot) => snapshot.reviewDays));
  return {
    format: SNAPSHOT_FORMAT,
    createdAt,
    lessons: [...lessons.values()].sort((a, b) => a.id.localeCompare(b.id)),
    packages: [...new Set(snapshots.flatMap((snapshot) => snapshot.packages))].sort(),
    blocks: [...blocks.values()].sort(
      (a, b) => a.lessonId.localeCompare(b.lessonId) || a.blockId.localeCompare(b.blockId),
    ),
    states: [...states.values()].sort((a, b) => storedKey(a.ref).localeCompare(storedKey(b.ref))),
    skills: [...skills.values()].sort((a, b) => storedKey(a.ref).localeCompare(storedKey(b.ref))),
    stats: mergeStats(
      base.stats,
      snapshots.map((snapshot) => snapshot.stats),
      snapshots.map((snapshot) => snapshot.skills),
    ),
    ...(Object.keys(reviewDays).length ? { reviewDays } : {}),
  };
}
const stateRef = (key: string, base: CompactSnapshot, snapshots: CompactSnapshot[]): StoredRef =>
  [base, ...snapshots].flatMap((snapshot) => snapshot.states).find((state) => storedKey(state.ref) === key)!.ref;
