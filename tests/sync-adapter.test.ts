import { afterEach, describe, expect, it, vi } from "vitest";
import { checksum, kvAdapter, parsePartKey, partKey, pointerKey, splitParts } from "../src/sync/adapter";
import { encodeSnapshot } from "../src/sync/codec";
import { packSnapshot, unpackSnapshot } from "../src/sync/compression";
import { cloudStorageTransport, disabledTransport, memoryTransport, SyncError } from "../src/sync/transport";
import { SNAPSHOT_FORMAT, type CompactSnapshot, type VersionMeta } from "../src/sync/types";
import type { TelegramCloudStorage } from "../src/platform/telegram-types";

const noise = (index: number, salt: number) => Number((((index + 1) * 2654435761 * salt) % 1e9) / 1e8);
const snapshot = (size = 0): CompactSnapshot => ({
  format: SNAPSHOT_FORMAT,
  createdAt: "2026-09-16T10:00:00.000Z",
  lessons: [],
  packages: ["mech-1"],
  blocks: [],
  states: Array.from({ length: size }, (_, index) => ({
    ref: { kind: "word" as const, id: `w11-${String(index).padStart(2, "0")}` },
    card: {
      due: "2026-09-17T00:00:00.000Z",
      stability: noise(index, 7),
      difficulty: noise(index, 13),
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
const metaOf = (
  id: string,
  device: string,
  clock: Record<string, number>,
  resolves: string[] = [],
  format: number = SNAPSHOT_FORMAT,
): Omit<VersionMeta, "parts" | "checksum" | "content"> => ({
  id,
  device,
  clock,
  createdAt: "2026-09-16T10:00:00.000Z",
  format,
  resolves,
});
const written = (data: CompactSnapshot, format: number = SNAPSHOT_FORMAT) =>
  format === 6 ? packSnapshot(encodeSnapshot(data, 6)) : encodeSnapshot(data, format);
const setItems = (memory: { log: string[] }) => memory.log.filter((entry) => entry.startsWith("setItem"));

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

const contract = variants.flatMap(([name, make]) => [5, 6].map((format) => [name, format, make] as const));
describe.each(contract)("контракт адаптера синхронизации: %s, формат %i", (_, format, make) => {
  const meta = (id: string, device: string, clock: Record<string, number>) => metaOf(id, device, clock, [], format);
  it("публикует версию частями с указателем последним и читает её целиком", async () => {
    const { transport, memory } = make();
    const adapter = kvAdapter(transport);
    const data = snapshot(600);
    const published = (await adapter.publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), data)).meta;
    expect(published.parts).toBeGreaterThan(1);
    const text = written(data, format);
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
    const first = (await adapter.publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), snapshot(50))).meta;
    const before = memory.store.size;
    const second = (await adapter.publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), snapshot(50))).meta;
    expect(second).toEqual(first);
    expect(memory.store.size).toBe(before);
  });
  it("обрыв на любой стадии не выдаёт неполную версию за доступную", async () => {
    const data = snapshot(600);
    const total = splitParts(written(data, format)).length;
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
      const published = (await kvAdapter(clean).publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), data)).meta;
      expect(await kvAdapter(clean).readVersion(published)).toEqual(data);
    }
  });
  it("неполное чтение и повреждение частей — ошибка целостности, а не частичные данные", async () => {
    const { transport, memory } = make();
    const adapter = kvAdapter(transport);
    const published = (await adapter.publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), snapshot(600))).meta;
    memory.store.delete(partKey("dev1-1", 1));
    await expect(adapter.readVersion(published)).rejects.toMatchObject({ kind: "integrity" });
    memory.store.set(partKey("dev1-1", 1), "x".repeat(10));
    await expect(adapter.readVersion(published)).rejects.toMatchObject({ kind: "integrity" });
  });
  it("неизвестный формат не читается и не считается пригодной версией", async () => {
    const { transport, memory } = make();
    const adapter = kvAdapter(transport);
    const published = (await adapter.publishVersion(meta("dev1-1", "dev1", { dev1: 1 }), snapshot(3))).meta;
    memory.store.set(pointerKey("dev1"), JSON.stringify({ ...published, format: SNAPSHOT_FORMAT + 1 }));
    const listing = await adapter.listPointers();
    expect(listing.pointers[0].format).toBe(SNAPSHOT_FORMAT + 1);
    await expect(adapter.readVersion(listing.pointers[0])).rejects.toMatchObject({
      kind: "format",
      message: expect.stringMatching(/Перезапустите приложение/),
    });
    memory.store.set(pointerKey("dev2"), "не json");
    expect((await adapter.listPointers()).invalid).toEqual([pointerKey("dev2")]);
  });
  it("лимит ключей проверяется до записи с учётом собственного указателя", async () => {
    const data = snapshot(600);
    const parts = splitParts(written(data, format)).length; // части + указатель = ровно лимит
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
  it("удаление другого устройства: указатель и его части не новее указателя, только если указатель не сменился", async () => {
    const { transport, memory } = make();
    const adapter = kvAdapter(transport);
    const old = (await adapter.publishVersion(meta("dev2-1", "dev2", { dev2: 1 }), snapshot(60))).meta;
    await adapter.publishVersion(meta("dev3-1", "dev3", { dev3: 1 }), snapshot(60));
    const fresh = (await adapter.publishVersion(meta("dev2-2", "dev2", { dev2: 2 }), snapshot(60))).meta;
    // Устройство успело опубликовать новую версию: старый указатель уже не тот — ничего не удаляется.
    const keys = memory.store.size;
    expect(await adapter.removeDevice(old)).toBe(false);
    expect(memory.store.size).toBe(keys);
    expect(await adapter.removeDevice(fresh)).toBe(true);
    const left = [...memory.store.keys()];
    expect(left).not.toContain(pointerKey("dev2"));
    expect(left.filter((key) => parsePartKey(key)?.versionId.startsWith("dev2-"))).toHaveLength(0);
    expect(left).toContain(pointerKey("dev3"));
    expect(left.filter((key) => parsePartKey(key)?.versionId === "dev3-1").length).toBeGreaterThan(0);
  });
});

it("отключённый транспорт веба отвечает явной ошибкой, а не фиктивным успехом", async () => {
  const adapter = kvAdapter(disabledTransport());
  expect(adapter.capabilities().available).toBe(false);
  await expect(adapter.listPointers()).rejects.toMatchObject({ kind: "unavailable" });
  await expect(adapter.publishVersion(metaOf("a-1", "a", { a: 1 }), snapshot(1))).rejects.toMatchObject({
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

describe("удаление указателя другого устройства", () => {
  it("устройство опубликовало новую версию во время удаления: его новый указатель и части остаются", async () => {
    let during: (() => Promise<void>) | null = null;
    const memory = memoryTransport({
      intercept: async (op) => {
        if (op !== "getKeys" || !during) return;
        const publish = during;
        during = null;
        await publish();
      },
    });
    const adapter = kvAdapter(memory);
    const old = (await adapter.publishVersion(metaOf("dev2-1", "dev2", { dev2: 1 }), snapshot(60))).meta;
    during = async () => {
      await adapter.publishVersion(metaOf("dev2-2", "dev2", { dev2: 2 }), snapshot(60));
    };
    expect(await adapter.removeDevice(old)).toBe(false);
    const keys = [...memory.store.keys()];
    expect(keys).toContain(pointerKey("dev2"));
    expect(keys.filter((key) => parsePartKey(key)?.versionId === "dev2-2").length).toBeGreaterThan(0);
    const { pointers } = await adapter.listPointers();
    expect(pointers.map((pointer) => pointer.id)).toEqual(["dev2-2"]);
  });
});

describe("формат 6: упаковка снимка", () => {
  afterEach(() => {
    vi.doUnmock("../src/sync/compression");
    vi.doUnmock("../src/sync/types");
    vi.resetModules();
  });

  it("указатель формата 6 несёт сумму содержимого, части — ASCII до 4 000 символов, и их меньше, чем у JSON", async () => {
    const memory = memoryTransport();
    const data = snapshot(600);
    const { meta: published, chars } = await kvAdapter(memory).publishVersion(
      metaOf("dev1-1", "dev1", { dev1: 1 }, [], 6),
      data,
    );
    expect(published.format).toBe(6);
    expect(published.content).toBe(checksum(encodeSnapshot(data, 6)));
    expect(JSON.parse(memory.store.get(pointerKey("dev1"))!)).toMatchObject({ format: 6, content: published.content });
    const parts = Array.from({ length: published.parts }, (_, index) => memory.store.get(partKey("dev1-1", index))!);
    expect(parts.every((part) => /^[\x20-\x7e]*$/.test(part) && part.length <= 4000)).toBe(true);
    expect(published.parts).toBeLessThan(splitParts(encodeSnapshot(data, 5)).length);
    expect(JSON.parse(unpackSnapshot(parts.join(""))).f).toBe(6);
    expect(chars).toBe(parts.join("").length);
  });
  it("подменённый поток с верной суммой частей, но чужим содержимым — ошибка целостности", async () => {
    const memory = memoryTransport();
    const adapter = kvAdapter(memory);
    const published = (await adapter.publishVersion(metaOf("dev1-1", "dev1", { dev1: 1 }, [], 6), snapshot(600))).meta;
    const forged = packSnapshot(encodeSnapshot(snapshot(10), 6));
    memory.store.set(partKey("dev1-1", 0), forged);
    const meta = { ...published, parts: 1, checksum: checksum(forged) };
    await expect(adapter.readVersion(meta)).rejects.toMatchObject({ kind: "integrity" });
    await expect(adapter.readVersion({ ...meta, content: undefined })).rejects.toMatchObject({ kind: "integrity" });
  });
  it("нераспаковываемые части с верной суммой — ошибка целостности", async () => {
    const memory = memoryTransport();
    const adapter = kvAdapter(memory);
    const published = (await adapter.publishVersion(metaOf("dev1-1", "dev1", { dev1: 1 }, [], 6), snapshot(3))).meta;
    memory.store.set(partKey("dev1-1", 0), "AAAA");
    await expect(adapter.readVersion({ ...published, parts: 1, checksum: checksum("AAAA") })).rejects.toMatchObject({
      kind: "integrity",
    });
  });
  it("формат внутри снимка не совпадает с форматом указателя — ошибка целостности", async () => {
    const memory = memoryTransport();
    const adapter = kvAdapter(memory);
    const published = (await adapter.publishVersion(metaOf("dev1-1", "dev1", { dev1: 1 }, [], 6), snapshot(3))).meta;
    const json = encodeSnapshot(snapshot(3), 5);
    const text = packSnapshot(json);
    memory.store.set(partKey("dev1-1", 0), text);
    await expect(
      adapter.readVersion({ ...published, parts: 1, checksum: checksum(text), content: checksum(json) }),
    ).rejects.toMatchObject({ kind: "integrity" });
  });
  it("упаковщик вернул испорченный поток — ошибка до записи, в облаке ни одной записи", async () => {
    vi.resetModules();
    vi.doMock("../src/sync/compression", async (original) => {
      const codec = await original<typeof import("../src/sync/compression")>();
      return {
        ...codec,
        packSnapshot: (json: string) => {
          const bytes = Buffer.from(codec.packSnapshot(json), "base64");
          bytes[Math.floor(bytes.length / 2)] ^= 0xff;
          return bytes.toString("base64");
        },
      };
    });
    const { kvAdapter: brokenAdapter } = await import("../src/sync/adapter");
    const memory = memoryTransport();
    await expect(
      brokenAdapter(memory).publishVersion(metaOf("dev1-1", "dev1", { dev1: 1 }, [], 6), snapshot(600)),
    ).rejects.toBeInstanceOf(Error);
    expect(setItems(memory)).toEqual([]);
    expect(memory.store.size).toBe(0);
  });
  it("формат 5 пишется прежним JSON с f: 5, который читает сборка формата 5", async () => {
    const memory = memoryTransport();
    const data = snapshot(600);
    const published = (await kvAdapter(memory).publishVersion(metaOf("dev1-1", "dev1", { dev1: 1 }, [], 5), data)).meta;
    expect(published.content).toBeUndefined();
    const text = Array.from({ length: published.parts }, (_, index) => memory.store.get(partKey("dev1-1", index))).join(
      "",
    );
    expect(text).toBe(encodeSnapshot(data, 5));
    expect(JSON.parse(text).f).toBe(5);
    vi.resetModules();
    vi.doMock("../src/sync/types", async (original) => ({
      ...(await original<typeof import("../src/sync/types")>()),
      SNAPSHOT_FORMAT: 5,
      SUPPORTED_SNAPSHOT_FORMATS: [3, 4, 5],
    }));
    const old = await import("../src/sync/adapter");
    const [pointer] = (await old.kvAdapter(memory).listPointers()).pointers;
    expect(await old.kvAdapter(memory).readVersion(pointer)).toEqual({ ...data, format: 5 });
  });
  it.each([7, 4])("формат записи %i — отказ format до записи", async (format) => {
    const memory = memoryTransport();
    await expect(
      kvAdapter(memory).publishVersion(metaOf("dev1-1", "dev1", { dev1: 1 }, [], format), snapshot(3)),
    ).rejects.toMatchObject({ kind: "format" });
    expect(setItems(memory)).toEqual([]);
  });
});

it("версия формата 5, записанная прежним приложением, читается", async () => {
  const memory = memoryTransport();
  const data = snapshot(600);
  const text = encodeSnapshot(data, 5);
  const parts = splitParts(text);
  parts.forEach((part, index) => memory.store.set(partKey("old-3", index), part));
  memory.store.set(
    pointerKey("old"),
    JSON.stringify({
      id: "old-3",
      device: "old",
      clock: { old: 3 },
      createdAt: "2026-09-16T10:00:00.000Z",
      format: 5,
      parts: parts.length,
      checksum: checksum(text),
      resolves: [],
    }),
  );
  const adapter = kvAdapter(memory);
  const [pointer] = (await adapter.listPointers()).pointers;
  expect(await adapter.readVersion(pointer)).toEqual(data);
});

describe("объявление читаемых форматов в своём указателе", () => {
  const publish = async (memory: ReturnType<typeof memoryTransport>) =>
    (await kvAdapter(memory).publishVersion(metaOf("dev1-1", "dev1", { dev1: 1 }, [], 6), snapshot(600))).meta;

  it("меняет только reads в сыром значении: content и незнакомые поля сохраняются, версия читается", async () => {
    const memory = memoryTransport();
    const published = await publish(memory);
    const raw = JSON.parse(memory.store.get(pointerKey("dev1"))!);
    memory.store.set(pointerKey("dev1"), JSON.stringify({ ...raw, zz: { future: true } }));
    expect(await kvAdapter(memory).declareReads("dev1", "dev1-1", [3, 4, 5])).toBe(true);
    expect(JSON.parse(memory.store.get(pointerKey("dev1"))!)).toEqual({
      ...raw,
      zz: { future: true },
      reads: [3, 4, 5],
    });
    const [pointer] = (await kvAdapter(memory).listPointers()).pointers;
    expect(await kvAdapter(memory).readVersion(pointer)).toEqual({ ...snapshot(600), format: SNAPSHOT_FORMAT });
    expect(pointer.content).toBe(published.content);
  });
  it("указатель другой версии или нет частей — записи нет", async () => {
    const memory = memoryTransport();
    await publish(memory);
    const before = setItems(memory).length;
    expect(await kvAdapter(memory).declareReads("dev1", "dev1-0", [3, 4, 5, 6])).toBe(false);
    memory.store.delete(partKey("dev1-1", 0));
    expect(await kvAdapter(memory).declareReads("dev1", "dev1-1", [3, 4, 5, 6])).toBe(false);
    expect(setItems(memory).length).toBe(before);
  });
  it("части удалены между проверкой и записью — указатель без частей не остаётся", async () => {
    const memory = memoryTransport();
    const published = await publish(memory);
    const write = memory.setItem.bind(memory);
    memory.setItem = async (key, value) => {
      if (key === pointerKey("dev1"))
        for (let index = 0; index < published.parts; index++) memory.store.delete(partKey("dev1-1", index));
      await write(key, value);
    };
    expect(await kvAdapter(memory).declareReads("dev1", "dev1-1", [3, 4, 5, 6])).toBe(false);
    expect(memory.store.has(pointerKey("dev1"))).toBe(false);
  });
});

describe("чанк упаковки не загрузился (сборка обновилась после деплоя)", () => {
  afterEach(() => {
    vi.doUnmock("../src/sync/compression");
    vi.resetModules();
  });
  it("отказ — ошибка stale с просьбой перезапустить; следующая попытка грузит модуль заново", async () => {
    vi.resetModules();
    vi.doMock("../src/sync/compression", () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    });
    const { kvAdapter: staleAdapter } = await import("../src/sync/adapter");
    const memory = memoryTransport();
    const adapter = staleAdapter(memory);
    await expect(
      adapter.publishVersion(metaOf("dev1-1", "dev1", { dev1: 1 }, [], 6), snapshot(3)),
    ).rejects.toMatchObject({ kind: "stale", message: expect.stringMatching(/Перезапустите приложение/) });
    expect(setItems(memory)).toEqual([]);
    vi.doUnmock("../src/sync/compression");
    const published = (await adapter.publishVersion(metaOf("dev1-1", "dev1", { dev1: 1 }, [], 6), snapshot(3))).meta;
    expect(published.format).toBe(6);
  });
});
