// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { BLOCKED_ERASE, EraseFailure, eraseMyData, resumeErase, type EraseDeps } from "../src/storage/erase";
import { erasePhase, markErase } from "../src/storage/erase-marker";
import { memoryTransport, SyncError, type MemoryTransport } from "../src/sync/transport";
import { LockTimeout } from "../src/sync/coordinator";
import type { Profile } from "../src/storage/profile";
import type { TelegramWebApp } from "../src/platform/telegram-types";

const reporting = vi.hoisted(() => ({ cleared: 0 }));
vi.mock("../src/reporting/reporting", async (original) => ({
  ...(await original<typeof import("../src/reporting/reporting")>()),
  clearReportQueue: async () => {
    reporting.cleared++;
  },
}));

let counter = 0;
let database: AppDatabase;
let cloud: MemoryTransport;
let events: string[];
const telegram: Profile = { kind: "telegram", userId: 7, bot: "TetradioBot" } as Profile;
const bridge = (fields: Partial<TelegramWebApp> = {}) =>
  ({
    CloudStorage: { getItems: () => undefined },
    isVersionAtLeast: () => true,
    initDataUnsafe: { user: { id: 7, first_name: "A" } },
    ...fields,
  }) as unknown as TelegramWebApp;

function deps(fields: Partial<EraseDeps> = {}): EraseDeps & { resumed: () => boolean } {
  let resumed = false;
  return {
    database,
    profile: telegram,
    bridge: () => bridge(),
    sync: async () => ({
      halt: async (work) => {
        events.push("halt");
        await work();
      },
      resume: () => {
        resumed = true;
      },
    }),
    forget: async () => {
      events.push("forget");
      return "ok";
    },
    transport: () => cloud,
    showErasing: (message) => events.push(`screen:${message}`),
    reload: () => events.push("reload"),
    resumed: () => resumed,
    ...fields,
  };
}
const databases = async () => (await Dexie.getDatabaseNames()).filter((name) => !name.startsWith("__"));

beforeEach(async () => {
  database = new AppDatabase(`tetradio-tg-TetradioBot-erase-${++counter}`);
  await database.open();
  await new AppDatabase("tetradio-restore").open().then((restore) => restore.close());
  cloud = memoryTransport();
  for (const key of ["p_dev", "v_a_0", "cp_dev"]) await cloud.setItem(key, "1");
  events = [];
  reporting.cleared = 0;
  localStorage.setItem(`tetradio:haptics:${database.name}`, "off");
  localStorage.setItem("tetradio:haptics:tetradio-tg-TetradioBot-99", "off");
  localStorage.setItem("tetradio:feedback-draft", "черновик");
  localStorage.setItem("word-taps-hint", "1");
  localStorage.setItem("tetradio:auto-update-build", "abc");
  sessionStorage.setItem("tetradio:launch", "{}");
  sessionStorage.setItem("tetradio:start-consumed", "q");
  sessionStorage.setItem("__telegram__initParams", "{}");
  sessionStorage.setItem("scroll:/words", "120");
});
afterEach(async () => {
  database.close();
  for (const name of await databases()) await Dexie.delete(name);
  localStorage.clear();
  sessionStorage.clear();
});

describe("удаление моих данных в сессии", () => {
  it("с перепиской: переписка, облако под остановленной синхронизацией, отметка local, перезапуск; устройство ещё не тронуто", async () => {
    await eraseMyData(true, deps());
    expect(events[0]).toBe("forget");
    expect(events).toContain("halt");
    expect(events.at(-1)).toBe("reload");
    expect([...cloud.store.keys()]).toEqual([]);
    expect(erasePhase(database.name)).toBe("local");
    expect(await databases()).toContain(database.name);
    expect(sessionStorage.getItem("tetradio:start-skip-reload")).not.toBeNull();
  });

  it("без галочки переписка не трогается", async () => {
    await eraseMyData(false, deps());
    expect(events).not.toContain("forget");
  });

  const leaveWaitlist =
    (result: "ok" | "failed" | "stale" = "ok") =>
    async () => {
      events.push("waitlist");
      return result;
    };

  it("без галочки удаляются заявки на курсы, с галочкой — переписка, которая удаляет и заявки", async () => {
    await eraseMyData(false, deps({ leaveWaitlist: leaveWaitlist() }));
    expect(events[0]).toBe("waitlist");
    expect(events).not.toContain("forget");
    events = [];
    await eraseMyData(true, deps({ leaveWaitlist: leaveWaitlist() }));
    expect(events[0]).toBe("forget");
    expect(events).not.toContain("waitlist");
  });

  it.each([
    ["failed", "waitlist"],
    ["stale", "stale"],
  ] as const)("заявки не удалились (%s) — устройство и облако не тронуты", async (result, reason) => {
    const failure = await eraseMyData(false, deps({ leaveWaitlist: leaveWaitlist(result) })).catch(
      (error: unknown) => error,
    );
    expect(failure).toEqual(new EraseFailure(reason, false));
    expect([...cloud.store.keys()].length).toBe(3);
    expect(erasePhase(database.name)).toBeNull();
  });

  it.each([
    ["failed", "messages"],
    ["stale", "stale"],
  ] as const)("переписка не удалилась (%s) — ничего не удалено", async (result, reason) => {
    const failure = await eraseMyData(true, deps({ forget: async () => result })).catch((error: unknown) => error);
    expect(failure).toEqual(new EraseFailure(reason, false));
    expect([...cloud.store.keys()].length).toBe(3);
    expect(erasePhase(database.name)).toBeNull();
  });

  it.each([
    ["без моста", () => null],
    ["без CloudStorage", () => bridge({ CloudStorage: undefined })],
    ["клиент ниже 6.9", () => bridge({ isVersionAtLeast: () => false })],
    ["чужой владелец", () => bridge({ initDataUnsafe: { user: { id: 8, first_name: "B" } } })],
    ["мост без пользователя", () => bridge({ initDataUnsafe: {} })],
  ])("Telegram %s — отказ до удаления переписки, ничего не удалено", async (_, bridgeOf) => {
    const failure = await eraseMyData(true, deps({ bridge: bridgeOf })).catch((error: unknown) => error);
    expect(failure).toMatchObject({ reason: "unavailable", messagesGone: false });
    expect(events).not.toContain("forget");
    expect([...cloud.store.keys()].length).toBe(3);
  });

  it("сбой облака: отметки нет, синхронизация возвращена, переписка уже удалена", async () => {
    cloud.removeItems = async () => {
      throw new SyncError("transport", "timeout");
    };
    const used = deps();
    const failure = await eraseMyData(true, used).catch((error: unknown) => error);
    expect(failure).toMatchObject({ reason: "cloud", messagesGone: true });
    expect(used.resumed()).toBe(true);
    expect(erasePhase(database.name)).toBeNull();
    expect(events).not.toContain("reload");
  });

  it("модуль синхронизации не загрузился после удаления переписки — cloud с отметкой о переписке", async () => {
    const failure = await eraseMyData(
      true,
      deps({
        sync: async () => {
          throw new Error("chunk");
        },
      }),
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({ reason: "cloud", messagesGone: true });
  });

  it("облако недоступно во время удаления — unavailable; занятая блокировка — busy", async () => {
    cloud.removeItems = async () => {
      throw new SyncError("unavailable", "no cloud");
    };
    await expect(eraseMyData(false, deps())).rejects.toMatchObject({ reason: "unavailable" });
    const busy = deps({
      sync: async () => ({
        halt: async () => {
          throw new LockTimeout("busy");
        },
        resume: () => undefined,
      }),
    });
    await expect(eraseMyData(false, busy)).rejects.toMatchObject({ reason: "busy" });
  });

  it("вне Telegram — без облачного шага", async () => {
    await eraseMyData(false, deps({ profile: { kind: "mock", userId: 1 } as Profile, bridge: () => null }));
    expect([...cloud.store.keys()].length).toBe(3);
    expect(erasePhase(database.name)).toBe("local");
    expect(events.at(-1)).toBe("reload");
  });
});

describe("открытая база очереди отчётов", () => {
  it("SDK держит свою базу открытой — удаление в сессии не упирается в неё: облако, отметка local, перезапуск", async () => {
    const held = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("tetradio-error-reports");
      request.onsuccess = () => resolve(request.result);
    });
    await eraseMyData(false, deps());
    expect(events).not.toContain(`screen:${BLOCKED_ERASE}`);
    expect(events.at(-1)).toBe("reload");
    expect([...cloud.store.keys()]).toEqual([]);
    expect(erasePhase(database.name)).toBe("local");
    held.close();
  });
});

describe("доведение прерванного удаления", () => {
  const startup = (fields: Partial<EraseDeps> = {}) => {
    const ready = vi.fn(async () => undefined);
    const showChoice = vi.fn();
    return { ...deps(fields), ready, showChoice };
  };

  it("фаза local — без облака: очередь отчётов, обе базы, ключи профиля, перезапуск", async () => {
    markErase(database.name, "local");
    database.close();
    const used = startup({ bridge: () => null });
    await resumeErase("local", used);
    expect([...cloud.store.keys()].length).toBe(3);
    expect(reporting.cleared).toBe(1);
    expect(await databases()).not.toContain(database.name);
    expect(await databases()).not.toContain("tetradio-restore");
    expect(Object.keys(localStorage).sort()).toEqual([
      "tetradio:auto-update-build",
      "tetradio:haptics:tetradio-tg-TetradioBot-99",
    ]);
    expect(Object.keys(sessionStorage).sort()).toEqual([
      "__telegram__initParams",
      "tetradio:launch",
      "tetradio:start-consumed",
      "tetradio:start-skip-reload",
    ]);
    expect(erasePhase(database.name)).toBeNull();
    expect(events.at(-1)).toBe("reload");
  });

  it("база не удалилась — отметка local остаётся, экран про другие окна", async () => {
    markErase(database.name, "local");
    vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => {
      const request = {} as IDBOpenDBRequest;
      setTimeout(() => request.onerror?.(new Event("error")), 0);
      return request;
    });
    await resumeErase("local", startup());
    expect(erasePhase(database.name)).toBe("local");
    expect(events.at(-1)).toBe(`screen:${BLOCKED_ERASE}`);
    vi.restoreAllMocks();
  });

  it("фаза cloud — ждёт мост, облако, затем устройство", async () => {
    markErase(database.name, "cloud");
    const used = startup();
    await resumeErase("cloud", used);
    expect(used.ready).toHaveBeenCalled();
    expect([...cloud.store.keys()]).toEqual([]);
    expect(events.at(-1)).toBe("reload");
  });

  it("фаза cloud без облака — выбор «Повторить» или «Отменить», устройство не тронуто", async () => {
    markErase(database.name, "cloud");
    const used = startup({ bridge: () => null });
    await resumeErase("cloud", used);
    expect(used.showChoice).toHaveBeenCalled();
    expect(await databases()).toContain(database.name);
    expect(erasePhase(database.name)).toBe("cloud");
  });
});
