// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { markChanged } from "../src/storage/ops";
import { saveBlockProgress } from "../src/storage/course";
import { submitAnswer } from "./helpers/ops";
import { makeSession } from "../src/domain/learning";
import { progress } from "../src/domain/stats";
import { kvAdapter, partKey } from "../src/sync/adapter";
import { SyncCoordinator } from "../src/sync/coordinator";
import { memoryTransport, SyncError, type MemoryTransport } from "../src/sync/transport";
import { META, readMeta, writeMeta } from "../src/sync/snapshot";
import { installCompleted } from "./helpers/content";
import { exportFull, restoreBackup } from "../src/features/backup/backup";

let cloud: MemoryTransport;
let clockMs = Date.parse("2026-09-16T08:00:00Z");
const tick = (minutes = 1) => {
  clockMs += minutes * 60000;
  return new Date(clockMs);
};
const now = () => new Date(clockMs);
let counter = 0;

function coordinator(db: AppDatabase, label: string) {
  return new SyncCoordinator({
    database: db,
    adapter: kvAdapter(cloud),
    now,
    label,
    schedule: () => () => undefined,
    retryBaseMs: 1,
  });
}
async function device(name: string) {
  const db = new AppDatabase(`tetradio-reliability-${name}-${++counter}`);
  await db.delete();
  await db.open();
  await installCompleted(db, ["mech-1"]);
  return { db, sync: coordinator(db, name) };
}
type Device = Awaited<ReturnType<typeof device>>;
async function study(dev: Device, answers: boolean[], mode: "scheduled" | "practice" = "scheduled") {
  const source = dexieSource(dev.db);
  const session = await makeSession({
    source,
    now: tick(),
    random: () => 0.31,
    mode,
    ...(mode === "practice" && { refs: (await dev.db.cardStates.toArray()).map((state) => state.ref) }),
  });
  await dev.db.sessions.add(session);
  const items = session.items.filter((item) => !item.eventId).slice(0, answers.length);
  for (const [index, item] of items.entries())
    await submitAnswer({
      session,
      item,
      correct: answers[index],
      answer: "",
      responseTimeMs: 900,
      activeTimeMs: 900,
      timezone: "Asia/Nicosia",
      now: tick(),
      database: dev.db,
    });
}
/** Полная копия устройства в том виде, в каком её восстанавливает «Копия данных». */
async function backupOf(dev: Device) {
  const parsed = JSON.parse(await (await exportFull(dev.db)).text());
  return new Blob([JSON.stringify({ ...parsed, data: { ...parsed.data, databaseName: "tetradio" } })]);
}
const answers = async (dev: Device) => (await progress(dexieSource(dev.db), now())).totals.answers;
const pointerOf = async (dev: Device) => JSON.parse(cloud.store.get(`p_${await dev.sync.deviceId()}`)!);

async function pair() {
  const phone = await device("phone");
  const mac = await device("mac");
  await study(phone, [true, true, true]);
  expect((await phone.sync.exchange()).phase).toBe("synced");
  expect((await mac.sync.exchange()).phase).toBe("synced");
  return { phone, mac };
}
/** CloudStorage записал указатель, но ответ до приложения не дошёл. */
function loseNextPointerAck() {
  const original = cloud.setItem.bind(cloud);
  let armed = true;
  cloud.setItem = async (key, value) => {
    await original(key, value);
    if (armed && key.startsWith("p_")) {
      armed = false;
      throw new SyncError("transport", "Telegram CloudStorage не ответил за 15 с.");
    }
  };
}

beforeEach(() => {
  cloud = memoryTransport();
  clockMs = Date.parse("2026-09-16T08:00:00Z");
});

describe("потерянный ответ облака", () => {
  it("указатель записан, ответ потерян: без новых ответов телефон применяет версию компьютера без окна", async () => {
    const { phone, mac } = await pair();
    await study(phone, [true, false]);
    loseNextPointerAck();
    expect((await phone.sync.exchange()).phase).toBe("error");
    expect((await mac.sync.exchange()).phase).toBe("synced");
    await study(mac, [true, true]);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    const status = await phone.sync.exchange();
    expect(status.conflict).toBeNull();
    expect(status.phase).toBe("synced");
    expect(await answers(phone)).toBe(await answers(mac));
  });

  it("новые ответы после потерянного ответа облака получают новый номер версии и не теряются", async () => {
    const { phone, mac } = await pair();
    await study(phone, [true, false]);
    loseNextPointerAck();
    await phone.sync.exchange();
    const ghost = (await pointerOf(phone)).id;
    expect((await mac.sync.exchange()).phase).toBe("synced");
    await study(phone, [true, true, true]);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect((await pointerOf(phone)).id).not.toBe(ghost);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    expect(await answers(mac)).toBe(await answers(phone));
    await study(mac, [true]);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    const expected = await answers(mac);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await answers(phone)).toBe(expected);
  });
});

describe("пустая отметка изменений", () => {
  it("версию опубликовала прежняя сборка без записи о начатой публикации — окна тоже нет", async () => {
    const { phone, mac } = await pair();
    await study(phone, [true, false]);
    loseNextPointerAck();
    await phone.sync.exchange();
    // Литерал, а не META: у прежней сборки этого ключа нет вовсе.
    await writeMeta(phone.db, "sync:publishing", null);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    await study(mac, [true, true]);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    const status = await phone.sync.exchange();
    expect(status.conflict).toBeNull();
    expect(await answers(phone)).toBe(await answers(mac));
  });

  it("отметка без ответов, заданий и уроков после публикации не даёт окна выбора", async () => {
    const { phone, mac } = await pair();
    await phone.db.transaction("rw", phone.db.meta, () => markChanged(phone.db));
    await study(mac, [true]);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    const status = await phone.sync.exchange();
    expect(status.conflict).toBeNull();
    expect(await answers(phone)).toBe(await answers(mac));
  });

  it("ответ после публикации — по-прежнему конфликт", async () => {
    const { phone, mac } = await pair();
    await study(phone, [true]);
    await study(mac, [true]);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    expect((await phone.sync.exchange()).conflict?.kind).toBe("diverged");
  });

  it("черновик письма у сохранённого задания не ставит отметку", async () => {
    const { phone } = await pair();
    await saveBlockProgress("mech-1", "draft-block", { done: false, text: "Γεια" }, phone.db, tick());
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await readMeta(phone.db, META.dirty)).toBeNull();
    await saveBlockProgress("mech-1", "draft-block", { text: "Γεια σου", quiet: true }, phone.db, tick());
    await saveBlockProgress("mech-1", "draft-block", { text: "Γεια σου!" }, phone.db, tick());
    expect(await readMeta(phone.db, META.dirty)).toBeNull();
    await saveBlockProgress("mech-1", "draft-block", { done: true, text: "Γεια σου!" }, phone.db, tick());
    expect(await readMeta(phone.db, META.dirty)).not.toBeNull();
  });
});

describe("ответы не теряются", () => {
  it("ответы практики после публикации — конфликт, а не молчаливое применение облака", async () => {
    const { phone, mac } = await pair();
    await study(phone, [true, false, true], "practice");
    const before = await answers(phone);
    await study(mac, [true]);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    const status = await phone.sync.exchange();
    expect(status.conflict?.kind).toBe("diverged");
    expect(await answers(phone)).toBe(before);
  });

  it("восстановленная копия после потерянного ответа облака остаётся конфликтом `restored`", async () => {
    const { phone, mac } = await pair();
    await study(phone, [true, false]);
    loseNextPointerAck();
    await phone.sync.exchange();
    await writeMeta(phone.db, META.restored, new Date(clockMs).toISOString());
    await study(mac, [true]);
    await mac.sync.exchange();
    const status = await phone.sync.exchange();
    expect(status.conflict?.kind).toBe("restored");
  });

  it("ответ во время публикации не снимается чужой отметкой и уходит повторным заходом", async () => {
    const { phone, mac } = await pair();
    await study(phone, [true]);
    const original = cloud.setItem.bind(cloud);
    let answered = false;
    cloud.setItem = async (key, value) => {
      if (!answered && key.startsWith("v_")) {
        answered = true;
        await study(phone, [false]);
      }
      return original(key, value);
    };
    expect((await phone.sync.exchange()).phase).toBe("synced");
    cloud.setItem = original;
    expect(answered).toBe(true);
    expect(await readMeta(phone.db, META.dirty)).toBeNull();
    expect((await mac.sync.exchange()).phase).toBe("synced");
    expect(await answers(mac)).toBe(await answers(phone));
  });

  it("части записаны, указатель нет: ответы публикуются заново, а при ответах на компьютере — конфликт", async () => {
    const { phone, mac } = await pair();
    await study(phone, [true, true]);
    const original = cloud.setItem.bind(cloud);
    cloud.setItem = async (key, value) => {
      if (key.startsWith("p_")) throw new SyncError("transport", "Telegram CloudStorage не ответил за 15 с.");
      return original(key, value);
    };
    expect((await phone.sync.exchange()).phase).toBe("error");
    cloud.setItem = original;
    expect(await readMeta(phone.db, META.dirty)).not.toBeNull();
    await study(mac, [true]);
    await mac.sync.exchange();
    expect((await phone.sync.exchange()).conflict?.kind).toBe("diverged");
  });

  it("указатель потерянной версии убран уборкой — новая версия всё равно получает новый номер", async () => {
    const { phone, mac } = await pair();
    await study(phone, [true]);
    loseNextPointerAck();
    await phone.sync.exchange();
    const ghost = (await pointerOf(phone)).id;
    expect((await mac.sync.exchange()).phase).toBe("synced");
    cloud.store.delete(`p_${await phone.sync.deviceId()}`);
    await study(phone, [false]);
    await phone.sync.exchange();
    expect((await pointerOf(phone)).id).not.toBe(ghost);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    expect(await answers(mac)).toBe(await answers(phone));
  });
});

describe("«Решить позже»", () => {
  it("переживает перезапуск, пока версии облака те же; новая версия снова показывает окно", async () => {
    const { phone, mac } = await pair();
    await study(phone, [true]);
    await study(mac, [true]);
    await mac.sync.exchange();
    expect((await phone.sync.exchange()).conflict?.deferred).toBe(false);
    await phone.sync.deferChoice();
    expect(phone.sync.getStatus().conflict?.deferred).toBe(true);
    const restarted = coordinator(phone.db, "phone");
    expect((await restarted.exchange()).conflict?.deferred).toBe(true);
    await restarted.reviewChoice();
    expect(restarted.getStatus().conflict?.deferred).toBe(false);
    await restarted.deferChoice();
    await study(mac, [false]);
    await mac.sync.exchange();
    expect((await restarted.exchange()).conflict?.deferred).toBe(false);
  });

  it("откладываются версии, которые видел учащийся, а не найденные обменом позже", async () => {
    const { phone, mac } = await pair();
    await study(phone, [true]);
    await study(mac, [true]);
    await mac.sync.exchange();
    const seen = (await phone.sync.exchange()).conflict!.branches.filter((branch) => !branch.local).map((b) => b.id);
    await study(mac, [false]);
    await mac.sync.exchange();
    await phone.sync.exchange();
    await phone.sync.deferChoice(seen);
    expect(phone.sync.getStatus().conflict?.deferred).toBe(false);
  });
});

describe("«Решить позже» при сбое хранилища", () => {
  it("выбор откладывается до перезапуска, кнопка «Выбрать версию» остаётся", async () => {
    const { phone, mac } = await pair();
    await study(phone, [true]);
    await study(mac, [true]);
    await mac.sync.exchange();
    const status = await phone.sync.exchange();
    expect(status.conflict?.kind).toBe("diverged");
    const put = phone.db.meta.put.bind(phone.db.meta);
    phone.db.meta.put = ((row: { key: string }) =>
      row.key === META.later ? Promise.reject(new Error("QuotaExceededError")) : put(row as never)) as never;
    await expect(phone.sync.deferChoice()).rejects.toThrow("QuotaExceededError");
    phone.db.meta.put = put;
    expect(phone.sync.getStatus().conflict?.deferred).toBe(true);
  });
});

describe("время в окне выбора", () => {
  it("у версий — время последнего ответа", async () => {
    const { phone, mac } = await pair();
    await study(phone, [true]);
    const phoneLast = now().toISOString();
    await study(mac, [true]);
    const macLast = now().toISOString();
    await mac.sync.exchange();
    const [local, remote] = (await phone.sync.exchange()).conflict!.branches;
    expect(local.description.lastAnswerAt).toBe(phoneLast);
    expect(remote.description.lastAnswerAt).toBe(macLast);
  });
});

describe("время в окне выбора: уроки", () => {
  it("работа по уроку без повторений — тоже последний ответ", async () => {
    const { phone, mac } = await pair();
    const done = tick(30);
    await saveBlockProgress("mech-1", "lesson-block", { done: true }, phone.db, done);
    await study(mac, [true]);
    await mac.sync.exchange();
    const [local] = (await phone.sync.exchange()).conflict!.branches;
    expect(local.description.lastAnswerAt).toBe(done.toISOString());
  });
});

describe("публикация при сворачивании", () => {
  it("срочный обмен не трогает паузы курсов и не перечитывает облако перед записью", async () => {
    const { phone } = await pair();
    await study(phone, [true, false]);
    cloud.log.length = 0;
    await phone.sync.exchange({ urgent: true });
    const until = cloud.log.findIndex((entry) => entry.startsWith("setItem p_"));
    expect(cloud.log.slice(0, until).filter((entry) => !entry.startsWith("setItem v_"))).toEqual([
      "getKeys",
      "getItems",
    ]);
  });
});

describe("восстановление копии посреди обмена", () => {
  it("копия, восстановленная во время публикации, не теряется: следующий обмен — конфликт `restored`", async () => {
    const { phone, mac } = await pair();
    const copy = await backupOf(phone);
    const copied = await answers(phone);
    await study(phone, [true, false]);
    const original = cloud.setItem.bind(cloud);
    let restored = false;
    cloud.setItem = async (key, value) => {
      if (!restored && key.startsWith("p_")) {
        restored = true;
        await restoreBackup(copy, phone.db);
      }
      return original(key, value);
    };
    await phone.sync.exchange();
    cloud.setItem = original;
    expect(restored).toBe(true);
    await study(mac, [true]);
    await mac.sync.exchange();
    const status = await phone.sync.exchange();
    expect(status.conflict?.kind).toBe("restored");
    expect(await answers(phone)).toBe(copied);
    await Dexie.delete("tetradio-restore");
  });

  it("копия, восстановленная во время чтения версии облака, не заменяется ею", async () => {
    const { phone, mac } = await pair();
    const copy = await backupOf(phone);
    const copied = await answers(phone);
    await study(mac, [true]);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    const macVersion = `v_${await mac.sync.deviceId()}-`;
    const original = cloud.getItems.bind(cloud);
    let restored = false;
    cloud.getItems = async (keys) => {
      if (!restored && keys.some((key) => key.startsWith(macVersion))) {
        restored = true;
        await restoreBackup(copy, phone.db);
      }
      return original(keys);
    };
    await phone.sync.exchange();
    cloud.getItems = original;
    expect(restored).toBe(true);
    expect(await answers(phone)).toBe(copied);
    expect((await phone.sync.exchange()).conflict?.kind).toBe("restored");
    await Dexie.delete("tetradio-restore");
  });
});

describe("облако заполнилось во время записи", () => {
  it("ошибка записи без признака лимита при полном облаке — уборка и повтор", async () => {
    cloud = memoryTransport({ limits: { maxKeys: 40 } });
    const { phone, mac } = await pair();
    await study(phone, [true, false]);
    const device = await phone.sync.deviceId();
    const original = cloud.setItem.bind(cloud);
    let filled = false;
    cloud.setItem = async (key, value) => {
      if (!filled && key.startsWith("v_")) {
        filled = true;
        for (let index = 0; cloud.store.size < 40; index++) cloud.store.set(partKey(`${device}-0`, index), "x");
      }
      try {
        return await original(key, value);
      } catch (error) {
        if (error instanceof SyncError && error.kind === "limit") throw new SyncError("transport", "QUOTA_EXCEEDED");
        throw error;
      }
    };
    expect((await phone.sync.exchange()).phase).toBe("synced");
    cloud.setItem = original;
    expect(filled).toBe(true);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    expect(await answers(mac)).toBe(await answers(phone));
  });
});

describe("отсечка базы", () => {
  it("ответ, записанный после отсечки с более поздним временем, не выпадает из сводки и уходит в облако", async () => {
    const { phone, mac } = await pair();
    const base = (await phone.db.baseSummary.get("base"))!;
    await phone.db.baseSummary.put({ ...base, asOf: new Date(clockMs + 3_600_000).toISOString() });
    const before = await answers(phone);
    await study(phone, [false], "practice");
    expect(await answers(phone)).toBe(before + 1);
    await study(mac, [true]);
    await mac.sync.exchange();
    expect((await phone.sync.exchange()).conflict?.kind).toBe("diverged");
  });
});
