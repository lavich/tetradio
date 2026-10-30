import type { AppDatabase } from "../storage/db";
import { readMeta, writeMeta } from "./snapshot";
import type { Clock } from "./types";

/**
 * Цепочка предков для слияния: опорное звено (состояние облака без своих неопубликованных изменений) и свои
 * публикации после него. Лёгкий индекс читается каждым обменом, тексты звеньев — только при расхождении.
 */
export const ANCESTORS = "sync:ancestors";
export const ANCESTOR_PREFIX = "sync:ancestor:";
/** Своих подтверждённых публикаций хватает трёх: другое устройство публикует после чтения указателей. */
const KEEP_OWN = 3;

export interface AncestorLink {
  id: string;
  clock: Clock;
  format: number;
  own: boolean;
  confirmed: boolean;
}
const isLink = (link: AncestorLink) => typeof link?.id === "string" && typeof link.clock === "object";
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
export const ordered = (links: AncestorLink[]) =>
  [...links].sort((a, b) => Number(a.own) - Number(b.own) || counter(a.id) - counter(b.id));

/** Пишет индекс и тексты новых звеньев, удаляет тексты выпавших; вызывается внутри транзакции по `meta`. */
export async function writeChain(database: AppDatabase, links: AncestorLink[], texts: Record<string, string> = {}) {
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
/** Своя публикация: начатая — звено до записи частей, подтверждается после; прочитанная из облака — сразу подтверждённая. */
export async function addOwn(
  database: AppDatabase,
  link: { id: string; clock: Clock; format: number },
  text: string,
  confirmed = false,
) {
  const chain = (await readChain(database)).filter((item) => item.id !== link.id);
  await writeChain(database, [...chain, { ...link, own: true, confirmed }], { [link.id]: text });
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
export async function clearChain(database: AppDatabase) {
  await writeChain(database, []);
}
