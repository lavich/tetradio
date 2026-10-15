import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DBCoreCursor } from "dexie";
import { AppDatabase } from "../src/storage/db";
import * as media from "../src/content/media";
import { downloadLessonMedia, installLesson, installPackages, refreshCatalog } from "../src/content/client";
import { lessonOutlines } from "../src/storage/outlines";
import { content, memoryFetcher, packageOf } from "./helpers/content";

const LESSONS = content.catalog.lessons.map((lesson) => lesson.id);

/** Сколько записей пакетов прочитано целиком: ключи без значений не считаются. */
function countPackageReads(db: AppDatabase) {
  const reads = { rows: 0 };
  const seen = (value: unknown) => {
    if (value) reads.rows++;
  };
  db.use({
    stack: "dbcore",
    name: "package-reads",
    create: (down) => ({
      ...down,
      table: (name) => {
        const table = down.table(name);
        if (name !== "packages") return table;
        return {
          ...table,
          get: async (req) => {
            const value: unknown = await table.get(req);
            seen(value);
            return value;
          },
          getMany: async (req) => {
            const values: unknown[] = await table.getMany(req);
            values.forEach(seen);
            return values;
          },
          query: async (req) => {
            const result = await table.query(req);
            if (req.values) result.result.forEach(seen);
            return result;
          },
          openCursor: async (req) => {
            const cursor = await table.openCursor(req);
            if (!cursor || !req.values) return cursor;
            const visited = new Set<unknown>();
            return new Proxy(cursor, {
              get(target: DBCoreCursor, prop) {
                if (prop === "value" && !visited.has(target.primaryKey)) {
                  visited.add(target.primaryKey);
                  seen(target.value);
                }
                const value: unknown = Reflect.get(target, prop, target);
                return typeof value === "function" ? (value as () => unknown).bind(target) : value;
              },
            });
          },
        };
      },
    }),
  });
  return reads;
}

let db: AppDatabase;
let reads: { rows: number };
beforeEach(async () => {
  await new AppDatabase("tetradio-first-run").delete();
  db = new AppDatabase("tetradio-first-run");
  reads = countPackageReads(db);
  await db.open();
});
afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

describe("первый запуск на новом устройстве", () => {
  it("пакеты облачного прогресса ставятся пакетной установкой с одной уборкой медиа", async () => {
    const fetcher = memoryFetcher();
    await refreshCatalog(db, fetcher);
    const prune = vi.spyOn(media, "pruneMedia");
    reads.rows = 0;
    const result = await installPackages(LESSONS, db, fetcher);
    expect(result).toEqual({ installed: LESSONS.length, updated: 0, failed: 0 });
    expect((await db.packages.toCollection().primaryKeys()).sort()).toEqual([...LESSONS].sort());
    expect(prune).toHaveBeenCalledTimes(1);
    expect(reads.rows).toBeLessThanOrEqual(LESSONS.length);
  });
  it("качает не больше четырёх пакетов сразу, а ошибка одного не останавливает остальные", async () => {
    const copies = Array.from({ length: 10 }, (_, index) => `mech-copy-${index}`);
    const packages = Object.fromEntries(
      copies.map((id) => [`content/packages/${id}.json`, { ...packageOf("mech-1"), id }]),
    );
    const catalog = {
      ...content.catalog,
      lessons: copies.map((id, index) => ({
        ...content.catalog.lessons.find((lesson) => lesson.id === "mech-1")!,
        id,
        url: `content/packages/${id}.json`,
        position: index,
      })),
    };
    const base = memoryFetcher(content, { "content/catalog.json": catalog, ...packages });
    const broken = "content/packages/mech-copy-3.json";
    let active = 0;
    let peak = 0;
    const fetcher = {
      ...base,
      json: async (url: string) => {
        if (!(url in packages)) return base.json(url);
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        if (url === broken) throw new Error("сбой сети");
        return base.json(url);
      },
    };
    await refreshCatalog(db, fetcher);
    const result = await installPackages(copies, db, fetcher);
    expect(peak).toBe(4);
    expect(result).toEqual({ installed: copies.length - 1, updated: 0, failed: 1 });
    expect((await db.packages.toCollection().primaryKeys()).sort()).toEqual(
      copies.filter((id) => id !== "mech-copy-3").sort(),
    );
  });
  it("синхронизация отдаёт недостающие пакеты одной пакетной установкой", async () => {
    const client = await import("../src/content/client");
    const batch = vi.spyOn(client, "installPackages").mockResolvedValue({ installed: 0, updated: 0, failed: 0 });
    const single = vi.spyOn(client, "installLesson");
    const { sync } = await import("../src/sync/index");
    sync.onMissingPackages!(["mech-1", "mech-2"]);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith(["mech-1", "mech-2"]);
    expect(single).not.toHaveBeenCalled();
  });
});

describe("уборка медиа", () => {
  async function installed() {
    const fetcher = memoryFetcher();
    await refreshCatalog(db, fetcher);
    for (const id of LESSONS) await installLesson(id, db, fetcher);
    for (const id of LESSONS) await downloadLessonMedia(id, db, fetcher);
    return fetcher;
  }
  const usedMedia = () => [...new Set(LESSONS.flatMap((id) => packageOf(id).media.map((item) => item.id)))].sort();

  it("без лишних файлов не читает пакеты целиком", async () => {
    await installed();
    await lessonOutlines(LESSONS, db);
    reads.rows = 0;
    expect(await media.pruneMedia(db)).toBe(0);
    expect(reads.rows).toBe(0);
    expect((await db.assets.toCollection().primaryKeys()).sort()).toEqual(usedMedia());
  });
  it("удаляет файлы и ссылки, которые не упоминает ни один пакет, а нужные установленным урокам оставляет", async () => {
    await installed();
    await lessonOutlines(LESSONS, db);
    const kept = (await db.assets.get(usedMedia()[0]))!;
    await db.assets.put({ ...kept, id: "img-сирота" });
    await db.media.put({ ...(await db.media.get(kept.id))!, id: "img-сирота" });
    await db.assets.put({ ...kept, id: "img-без-ссылки" });
    expect(await media.pruneMedia(db)).toBe(2);
    expect((await db.assets.toCollection().primaryKeys()).sort()).toEqual(usedMedia());
    expect((await db.media.toCollection().primaryKeys()).sort()).toEqual(usedMedia());
  });
  it("мусор обновления, прерванного до уборки, удаляет следующая уборка", async () => {
    await installed();
    const shared = new Set(
      LESSONS.filter((id) => id !== "mech-1").flatMap((id) => packageOf(id).media.map((m) => m.id)),
    );
    const dropped = packageOf("mech-1").media.find((item) => !shared.has(item.id))!;
    const rest = packageOf("mech-1").media.filter((item) => item !== dropped);
    const next = { ...packageOf("mech-1"), version: `${packageOf("mech-1").version}-next`, media: rest };
    next.words = next.words.map((word) =>
      word.imageAssetId === dropped.id || word.audioAssetId === dropped.id
        ? { ...word, imageAssetId: undefined, audioAssetId: undefined }
        : word,
    );
    const url = `content/packages/mech-1@${next.version}.json`;
    const catalog = {
      ...content.catalog,
      lessons: content.catalog.lessons.map((l) => (l.id === "mech-1" ? { ...l, version: next.version, url } : l)),
    };
    const updated = memoryFetcher(content, { "content/catalog.json": catalog, [url]: next });
    await refreshCatalog(db, updated);
    await installLesson("mech-1", db, updated, false);
    expect(await db.assets.get(dropped.id)).toBeDefined();
    await lessonOutlines(LESSONS, db);
    expect(await media.pruneMedia(db)).toBe(1);
    expect(await db.assets.get(dropped.id)).toBeUndefined();
    expect(await db.media.get(dropped.id)).toBeUndefined();
  });
});
