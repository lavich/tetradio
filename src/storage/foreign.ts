import { kindOfCode } from "../domain/kinds";
import { isForeign, parseStoredKey, storedKey, unitKey } from "../domain/refs";
import { RECENT, type SkillSummary, type StatsSummary, type StoredType, type TypeSkill } from "../domain/skills";
import { knownType } from "../domain/type-codes";
import type { LearningRef, StoredRef } from "../domain/types";
import type { AppDatabase } from "./db";
import { STORED_KINDS } from "./kinds";

/** Ссылка, вид которой после обновления стал известен; иначе та же. */
const knownRef = (ref: StoredRef): StoredRef => {
  if (!isForeign(ref)) return ref;
  const kind = kindOfCode(ref.code);
  return kind ? { kind, id: ref.id } : ref;
};
const knownKey = (key: string) => {
  const ref = parseStoredKey(key);
  return ref ? storedKey(knownRef(ref)) : key;
};
const mergeRecent = (older: boolean[] = [], newer: boolean[] = []) => [...older, ...newer].slice(-RECENT);
const laterOf = (a: string, b: string) => (a > b ? a : b);

/** Записи бывшего незнакомого типа идут раньше записей того же типа, сделанных уже после обновления. */
const foreignFirst = <T>(record: Partial<Record<StoredType, T>>) => {
  const entries = Object.entries(record) as [StoredType, T][];
  return [
    ...entries.filter(([type]) => type !== knownType(type)),
    ...entries.filter(([type]) => type === knownType(type)),
  ];
};
const mergeTypes = (into: Partial<Record<StoredType, TypeSkill>>, type: StoredType, skill: TypeSkill) => {
  const previous = into[type];
  into[type] = previous
    ? { recent: mergeRecent(previous.recent, skill.recent), lastAt: laterOf(previous.lastAt, skill.lastAt) }
    : skill;
};
function knownSkills(skills: SkillSummary): SkillSummary {
  const types: Partial<Record<StoredType, TypeSkill>> = {};
  for (const [type, skill] of foreignFirst(skills.types)) mergeTypes(types, knownType(type), skill);
  return { ...skills, types, lastTypes: skills.lastTypes.map(knownType) };
}
/** Одна карточка под двумя ключами: старшие исходы — из бывшей незнакомой записи. */
function mergeSkills(older: SkillSummary, newer: SkillSummary): SkillSummary {
  const types = { ...older.types };
  for (const [type, skill] of Object.entries(newer.types) as [StoredType, TypeSkill][]) mergeTypes(types, type, skill);
  return { types, lastTypes: newer.lastTypes, cleanAssemblies: newer.cleanAssemblies };
}
function knownStats(stats: StatsSummary): StatsSummary {
  const recentByType: Partial<Record<StoredType, boolean[]>> = {};
  for (const [type, recent] of foreignFirst(stats.recentByType))
    recentByType[knownType(type)] = mergeRecent(recentByType[knownType(type)], recent);
  return {
    ...stats,
    recentByType,
    days: stats.days.map((day) => ({ ...day, keys: [...new Set(day.keys.map(knownKey))] })),
    answeredKeys: [...new Set(stats.answeredKeys.map(knownKey))],
  };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * После обновления приложение узнало вид или тип проверки, которые хранились как незнакомые: отложенные состояния,
 * навыки и сводка статистики переходят под обычные ключи, а состояние карточки с содержимым на устройстве
 * становится обычным прогрессом. Чтение и запись — одной транзакцией: обмен в другой вкладке не вклинится.
 */
export async function adoptKnownForeign(database: AppDatabase): Promise<void> {
  await database.transaction("rw", database.tables, async () => {
    for (const row of await database.cardStash.toArray()) {
      const ref = knownRef(row.ref);
      if (ref === row.ref) continue;
      const known = ref as LearningRef;
      const key = unitKey(known);
      await database.cardStash.delete(row.unitKey);
      const present = (await STORED_KINDS[known.kind].presentIds([known.id], database)).length > 0;
      const state = { ...row.state, ref: known };
      if (!present) await database.cardStash.put({ unitKey: key, ref: known, state });
      else if (!(await database.cardStates.get(key)))
        await database.cardStates.put({
          unitKey: key,
          ref: known,
          card: {
            ...state.card,
            due: new Date(state.card.due),
            last_review: state.card.last_review ? new Date(state.card.last_review) : undefined,
          },
          introducedAt: state.introducedAt,
          version: state.version,
        });
    }
    for (const row of await database.cardSkills.toArray()) {
      const ref = knownRef(row.ref);
      const skills = knownSkills(row.skills);
      if (ref === row.ref && same(skills, row.skills)) continue;
      const key = storedKey(ref);
      await database.cardSkills.delete(row.unitKey);
      const existing = key === row.unitKey ? undefined : await database.cardSkills.get(key);
      const merged = existing ? mergeSkills(skills, knownSkills(existing.skills)) : skills;
      await database.cardSkills.put({ unitKey: key, ref, skills: merged });
    }
    const base = await database.baseSummary.get("base");
    if (base) {
      const stats = knownStats(base.stats);
      if (!same(stats, base.stats)) await database.baseSummary.put({ ...base, stats });
    }
  });
}
