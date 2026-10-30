import type { AppDatabase } from "../storage/db";
import { loadCompression } from "./adapter";
import { dominates, mergeClocks, sameClock } from "./clock";
import { decodeSnapshot } from "./codec";
import { readMeta, writeMeta } from "./snapshot";
import type { Clock, CompactSnapshot } from "./types";

/**
 * Цепочка предков для слияния: опорное звено (состояние облака без своих неопубликованных изменений) и свои
 * публикации после него. Лёгкий индекс читается каждым обменом, тексты звеньев — только при расхождении.
 */
export const ANCESTORS = "sync:ancestors";
export const ANCESTOR_PREFIX = "sync:ancestor:";
/** Своих подтверждённых публикаций хватает трёх: другое устройство публикует после чтения указателей. */
const KEEP_OWN = 3;
const PACKED = 6;

export interface AncestorLink {
  id: string;
  clock: Clock;
  format: number;
  own: boolean;
  confirmed: boolean;
}
const isLink = (value: unknown): value is AncestorLink => {
  const link = value as AncestorLink;
  return (
    !!link &&
    typeof link.id === "string" &&
    !!link.clock &&
    typeof link.clock === "object" &&
    typeof link.format === "number" &&
    typeof link.own === "boolean" &&
    typeof link.confirmed === "boolean"
  );
};
export async function readChain(database: AppDatabase): Promise<AncestorLink[]> {
  try {
    const value: unknown = JSON.parse((await readMeta(database, ANCESTORS)) ?? "[]");
    return Array.isArray(value) ? value.filter(isLink) : [];
  } catch {
    return [];
  }
}
const counter = (id: string) => Number(id.slice(id.lastIndexOf("-") + 1)) || 0;
/** Опора, затем свои по номеру публикации. */
const ordered = (links: AncestorLink[]) =>
  [...links].sort((a, b) => Number(a.own) - Number(b.own) || counter(a.id) - counter(b.id));

/** Пишет индекс и тексты новых звеньев, удаляет тексты выпавших; вызывается внутри транзакции по `meta`. */
async function writeChain(database: AppDatabase, links: AncestorLink[], texts: Record<string, string> = {}) {
  const before = await readChain(database);
  const next = prune(links);
  const keep = new Set(next.map((link) => link.id));
  for (const link of before) if (!keep.has(link.id)) await writeMeta(database, ANCESTOR_PREFIX + link.id, null);
  for (const [id, text] of Object.entries(texts))
    if (keep.has(id)) await writeMeta(database, ANCESTOR_PREFIX + id, text);
  await writeMeta(database, ANCESTORS, next.length ? JSON.stringify(ordered(next)) : null);
}
/** Опора, последние три подтверждённые свои публикации и неподтверждённые попытки. */
function prune(links: AncestorLink[]): AncestorLink[] {
  const own = ordered(links.filter((link) => link.own && link.confirmed));
  return [
    ...links.filter((link) => !link.own),
    ...own.slice(-KEEP_OWN),
    ...links.filter((link) => link.own && !link.confirmed),
  ];
}

/** Новая опора; свои публикации остаются: при трёх устройствах предком другой ветви может быть своя. */
export async function setAnchor(
  database: AppDatabase,
  anchor: { id: string; clock: Clock; format: number },
  text: string,
) {
  const chain = (await readChain(database)).filter((link) => link.own && link.id !== anchor.id);
  await writeChain(database, [{ ...anchor, own: false, confirmed: true }, ...chain], { [anchor.id]: text });
}
/** Начатая своя публикация: звено до записи частей, подтверждается после. */
export async function addOwn(database: AppDatabase, link: { id: string; clock: Clock; format: number }, text: string) {
  const chain = (await readChain(database)).filter((item) => item.id !== link.id);
  await writeChain(database, [...chain, { ...link, own: true, confirmed: false }], { [link.id]: text });
}
/** Своя версия, прочитанная из облака (`nothingUnpublished`): сразу подтверждённое звено. */
export async function addConfirmedOwn(
  database: AppDatabase,
  link: { id: string; clock: Clock; format: number },
  text: string,
) {
  const chain = (await readChain(database)).filter((item) => item.id !== link.id);
  await writeChain(database, [...chain, { ...link, own: true, confirmed: true }], { [link.id]: text });
}
export async function confirmOwn(database: AppDatabase, id: string) {
  const chain = await readChain(database);
  if (!chain.some((link) => link.id === id)) return;
  await writeChain(
    database,
    chain.map((link) => (link.id === id ? { ...link, confirmed: true } : link)),
  );
}
export async function dropLink(database: AppDatabase, id: string) {
  await writeChain(
    database,
    (await readChain(database)).filter((link) => link.id !== id),
  );
}
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
export async function clearChain(database: AppDatabase) {
  await writeChain(database, []);
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
