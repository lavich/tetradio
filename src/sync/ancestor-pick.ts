import type { AppDatabase } from "../storage/db";
import { loadCompression } from "./adapter";
import { ANCESTOR_PREFIX, readChain, writeChain, ordered, type AncestorLink } from "./ancestors";
import { dominates, mergeClocks, sameClock } from "./clock";
import { decodeSnapshot } from "./codec";
import { readMeta } from "./snapshot";
import type { Clock, CompactSnapshot } from "./types";

const PACKED = 6;

/**
 * Версия облака совпала по содержанию со звеном: это звено с более широкими часами. Часы своих звеньев после него
 * тоже расширяются — они построены поверх него.
 */
export async function widen(database: AppDatabase, id: string, clock: Clock) {
  const chain = await readChain(database);
  const from = chain.find((link) => link.id === id);
  if (!from) return;
  const later = (link: AncestorLink) =>
    link.id === id || (link.own && from && dominates(link.clock, from.clock) && !sameClock(link.clock, from.clock));
  await writeChain(
    database,
    chain.map((link) => (later(link) ? { ...link, clock: mergeClocks(link.clock, clock) } : link)),
  );
}
/** Часы, которые цепочка подтверждает: объединение опоры и последней своей подтверждённой публикации. */
export function chainClock(chain: AncestorLink[]): Clock | null {
  const anchor = chain.find((link) => !link.own);
  const own = ordered(chain.filter((link) => link.own && link.confirmed)).at(-1);
  if (!anchor && !own) return null;
  return mergeClocks(anchor?.clock ?? {}, own?.clock ?? {});
}
/** Поэлементный минимум: общая часть истории всех ветвей. */
export function commonClock(clocks: Clock[]): Clock {
  const devices = new Set(clocks.flatMap((clock) => Object.keys(clock)));
  const common: Clock = {};
  for (const device of devices) {
    const count = Math.min(...clocks.map((clock) => clock[device] ?? 0));
    if (count > 0) common[device] = count;
  }
  return common;
}
/**
 * Предок набора ветвей — подтверждённое звено, часы которого равны общей части каждой пары ветвей: тогда ни одно
 * изменение после предка не входит в две ветви, и приросты ветвей можно складывать. Общей части всех ветвей мало: две
 * версии облака могут делить историю, которой нет здесь. Нет такого звена или цепочка не сходится с часами устройства —
 * предка нет.
 */
export function pickAncestor(chain: AncestorLink[], clock: Clock, branches: Clock[]): AncestorLink | null {
  const confirmed = chainClock(chain);
  if (!confirmed || !sameClock(confirmed, clock)) return null;
  const common = commonClock(branches);
  for (let i = 0; i < branches.length; i++)
    for (let j = i + 1; j < branches.length; j++)
      if (!sameClock(commonClock([branches[i], branches[j]]), common)) return null;
  return chain.find((link) => link.confirmed && sameClock(link.clock, common)) ?? null;
}
export async function readLinkSnapshot(database: AppDatabase, link: AncestorLink): Promise<CompactSnapshot | null> {
  const text = await readMeta(database, ANCESTOR_PREFIX + link.id);
  if (text === null) return null;
  try {
    if (link.format !== PACKED) return decodeSnapshot(text);
    const { unpackSnapshot } = await loadCompression();
    return decodeSnapshot(unpackSnapshot(text), PACKED);
  } catch {
    return null;
  }
}
