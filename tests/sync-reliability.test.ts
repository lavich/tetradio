// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { markChanged } from "../src/storage/ops";
import { saveBlockProgress } from "../src/storage/course";
import { submitAnswer } from "./helpers/ops";
import { makeSession } from "../src/domain/learning";
import { progress } from "../src/domain/stats";
import { kvAdapter } from "../src/sync/adapter";
import { SyncCoordinator } from "../src/sync/coordinator";
import { memoryTransport, SyncError, type MemoryTransport } from "../src/sync/transport";
import { META, readMeta, writeMeta } from "../src/sync/snapshot";
import { installCompleted } from "./helpers/content";

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
