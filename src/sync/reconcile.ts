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
 * `published` — объединение применено и опубликовано: координатор перечитывает облако, но окна из-за этого не показывает.
 * `again` — за время чтения появилось изменение: решить заново. `conflict` — предка нет или слияние не удалось: окно.
 */
export type ReconcileOutcome = "done" | "published" | "again" | "conflict";

/**
 * Расхождение с общим предком решается без окна. Сходимость: версия облака с тем же содержанием, что здесь или в звене
 * цепочки, принимается без публикации. Слияние: предок / здесь / облако, результат применяется с отметкой изменений и
 * публикуется обычной публикацией.
 */
export async function reconcile(
  host: ReconcileHost,
  device: string,
  flags: { clock: Clock; dirty: boolean },
  candidates: ConflictBranch[],
  texts: Map<string, VersionText>,
): Promise<ReconcileOutcome> {
  const { database } = host;
  const now = host.now();
  const chain = await readChain(database);
  const { mark, snapshot: raw } = await readMarkedSnapshot(database, now);
  let local: CompactSnapshot;
  let remote: ConflictBranch[];
  try {
    local = normalize(raw);
    remote = candidates.map((branch) => ({ ...branch, snapshot: normalize(branch.snapshot) }));
  } catch {
    return "conflict";
  }
  // Звено декодируется не больше раза за вызов: тексты звеньев — мегабайты.
  const decoded = new Map<string, Promise<CompactSnapshot | null>>();
  const linkSnapshot = (link: AncestorLink) => {
    if (!decoded.has(link.id))
      decoded.set(
        link.id,
        readLinkSnapshot(database, link).then((snapshot) => (snapshot ? normalize(snapshot) : null)),
      );
    return decoded.get(link.id)!;
  };
  const content = progressOf(local);
  const contents = new Map(remote.map((branch) => [branch.id, progressOf(branch.snapshot)]));
  const clocks = remote.map((branch) => branch.meta!.clock);
  if (!flags.dirty && remote.every((branch) => contents.get(branch.id) === content)) {
    const [first] = remote;
    const clock = mergeClocks(flags.clock, ...clocks);
    const text = texts.get(first.id)!;
    const accepted = await database.transaction("rw", database.meta, async () => {
      if ((await readMeta(database, META.dirty)) !== mark || (await readMeta(database, META.restored))) return false;
      await writeMeta(database, META.clock, JSON.stringify(clock));
      await writeMeta(database, META.applied, first.id);
      await setAnchor(database, [{ id: first.id, clock, format: text.format, text: text.text }]);
      return true;
    });
    if (!accepted) return "again";
    await host.confirm();
    return "done";
  }
  if (flags.dirty)
    for (const branch of remote)
      for (const link of chain) {
        // Версия облака может совпасть только со звеном, которое она покрывает.
        if (!link.confirmed || !dominates(branch.meta!.clock, link.clock)) continue;
        const snapshot = await linkSnapshot(link);
        if (!snapshot || progressOf(snapshot) !== contents.get(branch.id)) continue;
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
  let anchors: Anchor[];
  try {
    const ancestorSnapshot = await linkSnapshot(ancestorLink);
    if (!ancestorSnapshot) return "conflict";
    const ancestor: MergeInput = { snapshot: ancestorSnapshot, format: ancestorLink.format };
    const cloud = remote.map((branch): MergeInput => ({ snapshot: branch.snapshot, format: branch.meta!.format }));
    merged = mergeSnapshots(ancestor, [{ snapshot: local, format: SNAPSHOT_FORMAT }, ...cloud], now.toISOString());
    anchors = await cloudAnchors(chain, ancestorLink, ancestor, remote, cloud, texts, now, linkSnapshot);
  } catch (error) {
    host.report(error);
    return "conflict";
  }
  await keepBeforeMerge(host, device, raw, now);
  const clock = mergeClocks(flags.clock, ...clocks);
  const applied = await applySnapshot(database, merged, remote[0].id, clock, now, {
    merged: { mark },
    chain: () => setAnchor(database, anchors),
  });
  if (!applied) return "again";
  await host.installMissing(merged.packages);
  await host.publish(
    device,
    clock,
    remote.map((branch) => branch.id),
  );
  return "published";
}

type Anchor = { id: string; clock: Clock; format: number; text: string };
/**
 * Опора после слияния — состояние облака без своих неопубликованных изменений. Своя последняя подтверждённая
 * публикация, которую не видела ни одна версия облака, входит в опору слиянием: без неё опора не покрывала бы часы
 * устройства, и версия облака, объединившая то же, не нашла бы предка. Сами версии облака остаются звеньями рядом с ней:
 * следующая версия другого устройства может строиться на них, ещё не видя своей публикации.
 */
async function cloudAnchors(
  chain: AncestorLink[],
  ancestorLink: AncestorLink,
  ancestor: MergeInput,
  remote: ConflictBranch[],
  cloud: MergeInput[],
  texts: Map<string, VersionText>,
  now: Date,
  linkSnapshot: (link: AncestorLink) => Promise<CompactSnapshot | null>,
): Promise<Anchor[]> {
  const versions = remote.map((branch): Anchor => {
    const text = texts.get(branch.id)!;
    return { id: branch.id, clock: branch.meta!.clock, format: text.format, text: text.text };
  });
  const lastOwn = chain.filter((link) => link.own && link.confirmed).at(-1);
  const unseen =
    !!lastOwn &&
    lastOwn.id !== ancestorLink.id &&
    dominates(lastOwn.clock, ancestorLink.clock) &&
    !remote.some((branch) => dominates(branch.meta!.clock, lastOwn.clock));
  if (remote.length === 1 && !unseen) return versions;
  const ownSnapshot = unseen ? await linkSnapshot(lastOwn) : null;
  const inputs = ownSnapshot ? [{ snapshot: ownSnapshot, format: lastOwn!.format }, ...cloud] : cloud;
  const snapshot = mergeSnapshots(ancestor, inputs, now.toISOString());
  return [
    {
      id: `cloud-${remote.map((branch) => branch.id).join("+")}`,
      clock: mergeClocks(ownSnapshot ? lastOwn!.clock : {}, ...remote.map((branch) => branch.meta!.clock)),
      format: SNAPSHOT_FORMAT_TEXT,
      text: encodeSnapshot(snapshot, SNAPSHOT_FORMAT_TEXT),
    },
    ...versions,
  ];
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
