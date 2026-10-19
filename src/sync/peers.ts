import type { VersionMeta } from "./types";

/**
 * Реестр других устройств: объявленные `reads` и когда здесь впервые увидели их текущий указатель — по местным часам.
 * Указатель может пропасть из облака (уборка), а `createdAt` пишется часами публикующего устройства, которые могут
 * отставать или отсутствовать; согласование формата опирается на реестр, а не на один листинг.
 */
export interface Peer {
  pointer: string;
  reads: number[] | null;
  seenAt: string;
}
export type Peers = Record<string, Peer>;
export const ACTIVE_MS = 30 * 24 * 60 * 60 * 1000;
const LEGACY_READS = [3, 4, 5];

const signature = (pointer: VersionMeta) => `${pointer.id}|${pointer.reads?.join(",") ?? ""}`;
export const readsOf = (reads: number[] | null | undefined) => reads ?? LEGACY_READS;
const active = (peer: Peer, now: Date) => now.getTime() - Date.parse(peer.seenAt) <= ACTIVE_MS;

export function notePeers(peers: Peers, pointers: VersionMeta[], own: string, now: Date): Peers {
  const next: Peers = {};
  for (const pointer of pointers) {
    if (pointer.device === own) continue;
    const known = peers[pointer.device];
    const seen = signature(pointer);
    next[pointer.device] =
      known?.pointer === seen ? known : { pointer: seen, reads: pointer.reads ?? null, seenAt: now.toISOString() };
  }
  for (const [device, peer] of Object.entries(peers)) if (!next[device] && active(peer, now)) next[device] = peer;
  return next;
}
/** Наибольший формат не выше `highest`, который читают все активные устройства; не ниже 5. */
export function writeFormat(peers: Peers, now: Date, highest: number): number {
  const others = Object.values(peers).filter((peer) => active(peer, now));
  for (let format = highest; format > 5; format--)
    if (others.every((peer) => readsOf(peer.reads).includes(format))) return format;
  return Math.min(highest, 5);
}
/** Указатель активного устройства, не читающего `newest`, уборка не удаляет: иначе его забудут другие устройства. */
export const keepsPointer = (peers: Peers, pointer: VersionMeta, now: Date, newest: number) => {
  const peer = peers[pointer.device];
  return !!peer && active(peer, now) && !readsOf(pointer.reads).includes(newest);
};
