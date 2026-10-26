// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { kvAdapter, removeAllKeys } from "../src/sync/adapter";
import { LockTimeout, SyncCoordinator, webLockWait } from "../src/sync/coordinator";
import { memoryTransport, type MemoryTransport } from "../src/sync/transport";
import { clearErase, markErase } from "../src/storage/erase-marker";
import { installCompleted } from "./helpers/content";
import { markChanged } from "../src/storage/ops";

let counter = 0;
async function device(
  cloud: MemoryTransport,
  options: { exclusive?: (run: () => Promise<void>) => Promise<"acquired"> } = {},
) {
  const db = new AppDatabase(`tetradio-erase-${++counter}`);
  await db.delete();
  await db.open();
  await installCompleted(db, ["mech-1"]);
  await markChanged(db);
  const retries: (() => void)[] = [];
  const sync = new SyncCoordinator({
    database: db,
    adapter: kvAdapter(cloud),
    schedule: (run) => {
      retries.push(run);
      return () => undefined;
    },
    retryBaseMs: 1,
    ...options,
  });
  return { db, sync, retries };
}
const appKeys = (cloud: MemoryTransport) => [...cloud.store.keys()];

afterEach(() => localStorage.clear());

describe("удаление всех ключей облака", () => {
  it("указатели, затем паузы, затем части, затем прочие", async () => {
    const cloud = memoryTransport();
    for (const key of ["v_a_0", "x_other", "p_dev", "cp_dev", "v_a_1"]) await cloud.setItem(key, "1");
    const removed: string[][] = [];
    const removeItems = cloud.removeItems.bind(cloud);
    cloud.removeItems = async (keys) => {
      removed.push([...keys]);
      await removeItems(keys);
    };
    await removeAllKeys(cloud);
    expect(removed).toEqual([["p_dev"], ["cp_dev"], ["v_a_0", "v_a_1"], ["x_other"]]);
    expect(appKeys(cloud)).toEqual([]);
  });

  it("сбой транспорта — ошибка, ключи на месте", async () => {
    const cloud = memoryTransport();
    await cloud.setItem("p_dev", "1");
    cloud.removeItems = async () => {
      throw new Error("timeout");
    };
    await expect(removeAllKeys(cloud)).rejects.toThrow("timeout");
    expect(appKeys(cloud)).toEqual(["p_dev"]);
  });
});

describe("остановка обмена на время удаления", () => {
  it("ждёт идущего обмена, держит блокировку до конца работы, после — обмен не запускается", async () => {
    const cloud = memoryTransport();
    const order: string[] = [];
    const { sync } = await device(cloud, {
      exclusive: async (run) => {
        order.push("lock");
        await run();
        order.push("unlock");
        return "acquired";
      },
    });
    sync.start();
    const exchanging = sync.exchange().then(() => order.push("exchange done"));
    let published = 0;
    await sync.halt(async () => {
      order.push("work");
      published = appKeys(cloud).length;
      await removeAllKeys(cloud);
    });
    await exchanging;
    await markChanged((sync as unknown as { options: { database: AppDatabase } }).options.database);
    expect(order).toEqual(["exchange done", "lock", "work", "unlock"]);
    expect(published).toBeGreaterThan(0);
    await sync.exchange();
    sync.start();
    await sync.resolve("any");
    expect(appKeys(cloud)).toEqual([]);
  });

  it("остановка без повторов; resume возвращает обмен", async () => {
    const cloud = memoryTransport();
    const { sync, retries } = await device(cloud);
    sync.start();
    await sync.exchange();
    expect(appKeys(cloud).length).toBeGreaterThan(0);
    await sync.halt(async () => removeAllKeys(cloud));
    expect(appKeys(cloud)).toEqual([]);
    expect(retries).toEqual([]);
    sync.resume();
    await sync.exchange();
    expect(appKeys(cloud).length).toBeGreaterThan(0);
  });

  it("второе устройство с отметкой удаления не публикует, без отметки — публикует заново", async () => {
    const cloud = memoryTransport();
    const other = await device(cloud);
    await other.sync.exchange();
    expect(appKeys(cloud).length).toBeGreaterThan(0);
    await removeAllKeys(cloud);
    markErase(other.db.name, "cloud");
    await other.sync.exchange();
    expect(appKeys(cloud)).toEqual([]);
    clearErase(other.db.name);
    await other.sync.exchange();
    expect(appKeys(cloud).some((key) => key.startsWith("p_"))).toBe(true);
  });
});

describe("остановка: поздние поводы обмена", () => {
  it("start во время остановки запоминается — resume запускает обмен", async () => {
    const cloud = memoryTransport();
    const { sync } = await device(cloud);
    await sync.halt(async () => {
      sync.start();
    });
    expect(appKeys(cloud)).toEqual([]);
    sync.resume();
    await sync.exchange();
    expect(appKeys(cloud).length).toBeGreaterThan(0);
  });

  it("обмен, упавший во время остановки, не ставит повтор", async () => {
    const cloud = memoryTransport();
    cloud.getKeys = async () => {
      throw new Error("offline");
    };
    const { sync, retries } = await device(cloud);
    const running = sync.exchange();
    await sync.halt(async () => undefined);
    await running;
    expect(retries).toEqual([]);
  });

  it("resolve, начатый до остановки, после неё ничего не публикует", async () => {
    const cloud = memoryTransport();
    const { sync } = await device(cloud);
    const exchanging = sync.exchange();
    const resolving = sync.resolve("any");
    await sync.halt(async () => removeAllKeys(cloud));
    await Promise.all([exchanging, resolving]);
    expect(appKeys(cloud)).toEqual([]);
  });
});

describe("блокировка с ожиданием", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("без Web Locks работа выполняется сразу", async () => {
    vi.stubGlobal("navigator", {});
    const work = vi.fn(async () => undefined);
    expect(await webLockWait("x")(work)).toBe("unsupported");
    expect(work).toHaveBeenCalled();
  });

  it("тайм-аут ожидания — LockTimeout", async () => {
    vi.stubGlobal("navigator", {
      locks: {
        request: async () => {
          throw new DOMException("timed out", "TimeoutError");
        },
      },
    });
    await expect(webLockWait("x", 1)(async () => undefined)).rejects.toBeInstanceOf(LockTimeout);
  });
});
