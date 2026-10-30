import { readChain, setAnchor, type AncestorLink } from "./ancestors";
import { pickAncestor, readLinkSnapshot, widen } from "./ancestor-pick";
import { dominates, mergeClocks } from "./clock";
import { encodeSnapshot } from "./codec";
import type { ConflictBranch } from "./coordinator";
import { mergeSnapshots, normalize, type MergeInput } from "./merge";
import { SNAPSHOT_FORMAT_TEXT, type ReconcileHost, type VersionText } from "./reconcile-types";
import {
  applySnapshot,
  buildSnapshot,
  META,
  parseClock,
  progressOf,
  readMeta,
  SNAPSHOT_TABLES,
  writeMeta,
} from "./snapshot";
import { SNAPSHOT_FORMAT, type Clock, type CompactSnapshot } from "./types";

/** Снимок и отметка изменений, прочитанные вместе: слияние применяется, только если отметка с тех пор не менялась. */
const readMarkedSnapshot = (database: ReconcileHost["database"], now: Date) =>
  database.transaction(
    "r",
    SNAPSHOT_TABLES.map((name) => database.table(name)),
    async () => ({ mark: await readMeta(database, META.dirty), snapshot: await buildSnapshot(database, now) }),
  );
/** Строка «До объединения» среди отложенных версий. */
const MERGED_PREFIX = "merged-";

/**
 * Расхождение с общим предком решается без окна. Сходимость: версия облака с тем же содержанием, что здесь или в звене
 * цепочки, принимается без публикации. Слияние: предок / здесь / облако, результат применяется с отметкой изменений и
 * публикуется обычной публикацией. `conflict` — предка нет или слияние не удалось: окно, как раньше.
 */
export async function reconcile(
  host: ReconcileHost,
  device: string,
  flags: { clock: Clock; dirty: boolean },
  remote: ConflictBranch[],
  texts: Map<string, VersionText>,
): Promise<"done" | "again" | "conflict"> {
  const { database } = host;
  const now = host.now();
  const chain = await readChain(database);
  const { mark, snapshot: raw } = await readMarkedSnapshot(database, now);
  let local: CompactSnapshot;
  try {
    local = normalize(raw);
  } catch {
    return "conflict";
  }
  const content = progressOf(local);
  const clocks = remote.map((branch) => branch.meta!.clock);
  if (!flags.dirty && remote.every((branch) => progressOf(branch.snapshot) === content)) {
    const [first] = remote;
    const clock = mergeClocks(flags.clock, ...clocks);
    const text = texts.get(first.id)!;
    const accepted = await database.transaction("rw", database.meta, async () => {
      if ((await readMeta(database, META.dirty)) !== mark || (await readMeta(database, META.restored))) return false;
      await writeMeta(database, META.clock, JSON.stringify(clock));
      await writeMeta(database, META.applied, first.id);
      await setAnchor(database, { id: first.id, clock, format: text.format }, text.text);
      return true;
    });
    if (!accepted) return "again";
    await host.confirm();
    return "done";
  }
  if (flags.dirty)
    for (const branch of remote)
      for (const link of chain.filter((item) => item.confirmed)) {
        const snapshot = await readLinkSnapshot(database, link);
        if (!snapshot || progressOf(normalize(snapshot)) !== progressOf(branch.snapshot)) continue;
        // Версия облака — это звено с более широкими часами: публикация отправит только своё новое поверх неё.
        await database.transaction("rw", database.meta, async () => {
          const clock = parseClock(await readMeta(database, META.clock));
          await widen(database, link.id, branch.meta!.clock);
          await writeMeta(database, META.clock, JSON.stringify(mergeClocks(clock, branch.meta!.clock)));
        });
        return "again";
      }
  const issued = Number(await readMeta(database, META.issued)) || 0;
  const own = { ...flags.clock, [device]: Math.max(flags.clock[device] ?? 0, issued) };
  const ancestorLink = pickAncestor(chain, flags.clock, [own, ...clocks]);
  if (!ancestorLink) return "conflict";
  let merged: CompactSnapshot;
  let anchor: { id: string; clock: Clock; format: number; text: string };
  try {
    const ancestorSnapshot = await readLinkSnapshot(database, ancestorLink);
    if (!ancestorSnapshot) return "conflict";
    const ancestor: MergeInput = { snapshot: normalize(ancestorSnapshot), format: ancestorLink.format };
    const cloud = remote.map((branch): MergeInput => ({ snapshot: branch.snapshot, format: branch.meta!.format }));
    merged = mergeSnapshots(ancestor, [{ snapshot: local, format: SNAPSHOT_FORMAT }, ...cloud], now.toISOString());
    anchor = await cloudAnchor(host, chain, ancestorLink, ancestor, remote, cloud, texts, now);
  } catch (error) {
    host.report(error);
    return "conflict";
  }
  await keepBeforeMerge(host, device, raw, now);
  const clock = mergeClocks(flags.clock, ...clocks);
  const applied = await applySnapshot(database, merged, remote[0].id, clock, now, {
    merged: { mark },
    chain: () => setAnchor(database, { id: anchor.id, clock: anchor.clock, format: anchor.format }, anchor.text),
  });
  if (!applied) return "again";
  await host.installMissing(merged.packages);
  await host.publish(
    device,
    clock,
    remote.map((branch) => branch.id),
  );
  return "again";
}

/**
 * Опора после слияния — состояние облака без своих неопубликованных изменений: при одной ветви сама эта версия, при
 * нескольких — их слияние со своей последней подтверждённой публикацией. Без неё новая версия облака, пришедшая до
 * публикации слияния, не нашла бы предка.
 */
async function cloudAnchor(
  host: ReconcileHost,
  chain: AncestorLink[],
  ancestorLink: AncestorLink,
  ancestor: MergeInput,
  remote: ConflictBranch[],
  cloud: MergeInput[],
  texts: Map<string, VersionText>,
  now: Date,
) {
  if (remote.length === 1) {
    const [branch] = remote;
    const text = texts.get(branch.id)!;
    return { id: branch.id, clock: branch.meta!.clock, format: text.format, text: text.text };
  }
  const lastOwn = chain.filter((link) => link.own && link.confirmed).at(-1);
  // Своя публикация старше предка (опора новее неё) уже входит в предка.
  const ownSnapshot =
    lastOwn && lastOwn.id !== ancestorLink.id && dominates(lastOwn.clock, ancestorLink.clock)
      ? await readLinkSnapshot(host.database, lastOwn)
      : null;
  const inputs = ownSnapshot ? [{ snapshot: normalize(ownSnapshot), format: lastOwn!.format }, ...cloud] : cloud;
  const snapshot = mergeSnapshots(ancestor, inputs, now.toISOString());
  return {
    id: `cloud-${remote.map((branch) => branch.id).join("+")}`,
    clock: mergeClocks(ownSnapshot ? lastOwn!.clock : {}, ...remote.map((branch) => branch.meta!.clock)),
    format: SNAPSHOT_FORMAT_TEXT,
    text: encodeSnapshot(snapshot, SNAPSHOT_FORMAT_TEXT),
  };
}

/** Страховка: состояние до слияния — одна строка «До объединения» среди отложенных версий, новая заменяет прежнюю. */
async function keepBeforeMerge(host: ReconcileHost, device: string, snapshot: CompactSnapshot, now: Date) {
  const { database } = host;
  const id = `${MERGED_PREFIX}${device}-${now.getTime()}`;
  await database.transaction("rw", database.syncVersions, async () => {
    const previous = (await database.syncVersions.toCollection().primaryKeys()) as string[];
    await database.syncVersions.bulkDelete(previous.filter((key) => key.startsWith(MERGED_PREFIX)));
    await database.syncVersions.put({
      id,
      role: "rejected",
      createdAt: now.toISOString(),
      meta: {
        id,
        device,
        clock: {},
        createdAt: now.toISOString(),
        format: SNAPSHOT_FORMAT,
        parts: 0,
        checksum: "",
        resolves: [],
      },
      snapshot,
      note: "До объединения",
    });
  });
}
