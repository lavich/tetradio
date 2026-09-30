import { describe, expect, it } from "vitest";
import { checksum, kvAdapter, parsePartKey, partKey, pointerKey, splitParts } from "../src/sync/adapter";
import { encodeSnapshot } from "../src/sync/codec";
import { cloudStorageTransport, disabledTransport, memoryTransport, SyncError } from "../src/sync/transport";
import { SNAPSHOT_FORMAT, type CompactSnapshot, type VersionMeta } from "../src/sync/types";
import { defaultSettings } from "../src/domain/types";
import type { TelegramCloudStorage } from "../src/platform/telegram-types";

const snapshot = (size = 0): CompactSnapshot => ({
  format: SNAPSHOT_FORMAT,
  createdAt: "2026-09-16T10:00:00.000Z",
  settings: { timezone: defaultSettings.timezone, sessionSize: 20 },
  courses: [],
  lessons: [],
  packages: ["lesson-1-1"],
  states: Array.from({ length: size }, (_, index) => ({
    ref: { kind: "word" as const, id: `w11-${String(index).padStart(2, "0")}` },
    card: {
      due: "2026-09-17T00:00:00.000Z",
      stability: 2.123456789012,
      difficulty: 5.987654321098,
      elapsed_days: 1,
      scheduled_days: 1,
      reps: 1,
      lapses: 0,
      state: 2,
      learning_steps: 0,
    },
    introducedAt: "2026-09-15T00:00:00.000Z",
    version: 1,
  })),
  skills: [],
  stats: { days: [], recentByType: {}, answers: 0, answeredKeys: [] },
});
const meta = (
  id: string,
  device: string,
  clock: Record<string, number>,
  resolves: string[] = [],
): Omit<VersionMeta, "parts" | "checksum"> => ({
  id,
  device,
  clock,
  createdAt: "2026-09-16T10:00:00.000Z",
  format: SNAPSHOT_FORMAT,
  resolves,
});

/** Тот же контракт для CloudStorage через эмуляцию callback API и для транспорта в памяти. */
function fakeCloudStorage(memory = memoryTransport()): TelegramCloudStorage {
  const call = <T>(task: Promise<T>, done?: (error: string | null, value?: T) => void) => {
    task.then(
      (value) => done?.(null, value),
      (error) => done?.(String(error.message)),
    );
  };
  return {
    setItem: (key, value, done) =>
      call(
        memory.setItem(key, value).then(() => true),
        done,
      ),
    getItem: (key, done) =>
      call(
        memory.getItems([key]).then((items) => items[key]),
        done,
      ),
    getItems: (keys, done) => call(memory.getItems(keys), done),
    removeItem: (key, done) =>
      call(
        memory.removeItems([key]).then(() => true),
        done,
      ),
    removeItems: (keys, done) =>
      call(
        memory.removeItems(keys).then(() => true),
        done,
      ),
    getKeys: (done) => call(memory.getKeys(), done),
  };
}
const variants = [
  [
    "память",
    () => {
      const memory = memoryTransport();
      return { transport: memory, memory };
    },
  ],
  [
    "CloudStorage",
    () => {
      const memory = memoryTransport();
      return { transport: cloudStorageTransport(fakeCloudStorage(memory)), memory };
    },
  ],
] as const;

describe.each(variants)("контракт адаптера синхронизации: %s", (_, make) => {
  it("публикует версию частями с указателем последним и читает её целиком", async () => {
    const { transport, memory } = make();
    const adapter = kvAdapter(transport);
    const data = snapshot(120);
    const published = await adapter.publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), data);
    expect(published.parts).toBeGreaterThan(1);
    const text = encodeSnapshot(data);
    expect(splitParts(text).every((part) => part.length <= 4000)).toBe(true);
    expect(published.checksum).toBe(checksum(text));
    // Порядок записи: все части, затем указатель.
    const writes = memory.log.filter((entry) => entry.startsWith("setItem")).map((entry) => entry.slice(8));
    expect(writes[writes.length - 1]).toBe(pointerKey("dev1"));
    expect(writes.slice(0, -1)).toEqual(
      Array.from({ length: published.parts }, (_, index) => partKey("dev1-1", index)),
    );
    const listing = await adapter.listPointers();
    expect(listing.pointers).toEqual([published]);
    expect(await adapter.readVersion(published)).toEqual(data);
  });
  it("повтор публикации той же версии идемпотентен и не удваивает ключи", async () => {
    const { transport, memory } = make();
    const adapter = kvAdapter(transport);
    const first = await adapter.publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), snapshot(50));
    const before = memory.store.size;
    const second = await adapter.publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), snapshot(50));
    expect(second).toEqual(first);
    expect(memory.store.size).toBe(before);
  });
  it("обрыв на любой стадии не выдаёт неполную версию за доступную", async () => {
    const data = snapshot(120);
    const total = splitParts(encodeSnapshot(data)).length;
    for (let failAt = 0; failAt <= total; failAt++) {
      const memory = memoryTransport({
        intercept: (op, key) => {
          if (op === "setItem" && memory.log.filter((entry) => entry.startsWith("setItem")).length === failAt + 1)
            throw new SyncError("transport", `обрыв на ${key}`);
        },
      });
      const adapter = kvAdapter(memory);
      await expect(adapter.publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), data)).rejects.toMatchObject({
        kind: "transport",
      });
      const listing = await adapter.listPointers();
      expect(listing.pointers).toHaveLength(0); // указатель не записан — версии нет
      // Повтор с тем же идентификатором завершает публикацию.
      const clean = memoryTransport();
      for (const [key, value] of memory.store) clean.store.set(key, value);
      const published = await kvAdapter(clean).publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), data);
      expect(await kvAdapter(clean).readVersion(published)).toEqual(data);
    }
  });
  it("неполное чтение и повреждение частей — ошибка целостности, а не частичные данные", async () => {
    const { transport, memory } = make();
    const adapter = kvAdapter(transport);
    const published = await adapter.publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), snapshot(120));
    memory.store.delete(partKey("dev1-1", 1));
    await expect(adapter.readVersion(published)).rejects.toMatchObject({ kind: "integrity" });
    memory.store.set(partKey("dev1-1", 1), "x".repeat(10));
    await expect(adapter.readVersion(published)).rejects.toMatchObject({ kind: "integrity" });
  });
  it("неизвестный формат не читается и не считается пригодной версией", async () => {
    const { transport, memory } = make();
    const adapter = kvAdapter(transport);
    const published = await adapter.publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), snapshot(3));
    memory.store.set(pointerKey("dev1"), JSON.stringify({ ...published, format: SNAPSHOT_FORMAT + 1 }));
    const listing = await adapter.listPointers();
    expect(listing.pointers[0].format).toBe(SNAPSHOT_FORMAT + 1);
    await expect(adapter.readVersion(listing.pointers[0])).rejects.toMatchObject({
      kind: "format",
      message: expect.stringMatching(/Обновите приложение/),
    });
    memory.store.set(pointerKey("dev2"), "не json");
    expect((await adapter.listPointers()).invalid).toEqual([pointerKey("dev2")]);
  });
  it("лимит ключей проверяется до записи с учётом собственного указателя", async () => {
    const data = snapshot(120);
    const parts = splitParts(encodeSnapshot(data)).length; // части + указатель = ровно лимит
    const memory = memoryTransport({ limits: { maxKeys: parts + 1 } });
    const adapter = kvAdapter(memory);
    await adapter.publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), data);
    expect(memory.store.size).toBe(parts + 1);
    // Второе поколение того же устройства: указатель уже есть, но частей больше нет места.
    const writesBefore = memory.log.filter((entry) => entry.startsWith("setItem")).length;
    await expect(adapter.publishVersion(meta("dev1-2", "dev1", { dev1: 2 }), data)).rejects.toMatchObject({
      kind: "limit",
    });
    expect(memory.log.filter((entry) => entry.startsWith("setItem")).length).toBe(writesBefore); // ничего не записано
    await adapter.removeGenerations(["dev1-1"]);
    expect(memory.store.size).toBe(1);
    await adapter.publishVersion(meta("dev1-2", "dev1", { dev1: 2 }), data);
    expect((await adapter.room(0, "dev1")).free).toBe(0);
  });
  it("удаление поколений не трогает указатели и части других версий", async () => {
    const { transport, memory } = make();
    const adapter = kvAdapter(transport);
    await adapter.publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), snapshot(60));
    await adapter.publishVersion(meta("dev2-1", "dev2", { dev2: 1 }), snapshot(60));
    await adapter.removeGenerations(["dev1-1"]);
    const keys = [...memory.store.keys()];
    expect(keys.filter((key) => parsePartKey(key)?.versionId === "dev1-1")).toHaveLength(0);
    expect(keys.filter((key) => parsePartKey(key)?.versionId === "dev2-1").length).toBeGreaterThan(0);
    expect(keys).toContain(pointerKey("dev1"));
    expect(keys).toContain(pointerKey("dev2"));
  });
});

it("отключённый транспорт веба отвечает явной ошибкой, а не фиктивным успехом", async () => {
  const adapter = kvAdapter(disabledTransport());
  expect(adapter.capabilities().available).toBe(false);
  await expect(adapter.listPointers()).rejects.toMatchObject({ kind: "unavailable" });
  await expect(adapter.publishVersion(meta("a-1", "a", { a: 1 }), snapshot(1))).rejects.toMatchObject({
    kind: "unavailable",
  });
});
it("доменные модули не импортируют Telegram API", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const files = [
    ...readdirSync("src/domain").map((file) => `src/domain/${file}`),
    ...readdirSync("src/storage").map((file) => `src/storage/${file}`),
    "src/sync/adapter.ts",
    "src/sync/coordinator.ts",
    "src/sync/snapshot.ts",
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    expect(text, file).not.toMatch(/window\.Telegram|telegram-web-app|Telegram\.WebApp/);
  }
});
