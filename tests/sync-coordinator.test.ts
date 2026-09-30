import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { LexiDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { saveCourseTempo, saveSettings, submitAnswer, updateLesson } from "../src/storage/ops";
import { defaultSettings } from "../src/domain/types";
import { makePlan, makeSession } from "../src/domain/learning";
import { progress } from "../src/domain/stats";
import { kvAdapter } from "../src/sync/adapter";
import { SyncCoordinator } from "../src/sync/coordinator";
import { memoryTransport, disabledTransport, type MemoryTransport } from "../src/sync/transport";
import { META, readMeta, writeMeta } from "../src/sync/snapshot";
import { SNAPSHOT_FORMAT } from "../src/sync/types";
import { profileFor } from "../src/storage/profile";
import { installLessons, memoryFetcher } from "./helpers/content";
import { installLesson, refreshCatalog } from "../src/content/client";
import type { Word } from "../src/domain/types";
import { wordKeyOf, wordRef, wordState } from "./helpers/cards";

let cloud: MemoryTransport;
let clockMs = Date.parse("2026-09-16T08:00:00Z");
const tick = (minutes = 1) => {
  clockMs += minutes * 60000;
  return new Date(clockMs);
};
const now = () => new Date(clockMs);
let counter = 0;
async function device(name: string, options: { lessons?: string[]; label?: string; maxKeys?: number } = {}) {
  const db = new LexiDatabase(`lexi-sync-${name}-${++counter}`);
  await db.delete();
  await db.open();
  if (options.lessons) await installLessons(db, options.lessons);
  const sync = new SyncCoordinator({
    database: db,
    adapter: kvAdapter(cloud),
    now,
    label: options.label ?? name,
    schedule: () => () => undefined,
    retryBaseMs: 1,
  });
  return { db, sync, name };
}
type Device = Awaited<ReturnType<typeof device>>;
/** Занятие с фиксированной случайностью и ответами по списку; каждый ответ — минута спустя. */
async function study(dev: Device, answers: boolean[], mode: "scheduled" | "practice" = "scheduled") {
  const session = await makeSession({ source: dexieSource(dev.db), now: tick(), random: () => 0.31, mode });
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
  return items.map((item) => item.ref.id);
}
const skillsOf = async (dev: Device, ids: string[]) => {
  const source = dexieSource(dev.db);
  const cards = await source.cardsOf(ids.map(wordRef));
  return Object.fromEntries(
    await Promise.all(
      [...cards.values()].map(async (card) => [card.kind === "word" ? card.word.id : "", await source.skillsOf(card)]),
    ),
  );
};
const statesOf = async (dev: Device) =>
  (await dev.db.cardStates.orderBy("unitKey").toArray()).map((state) => ({
    ...state,
    card: {
      ...state.card,
      due: new Date(state.card.due).toISOString(),
      last_review: state.card.last_review ? new Date(state.card.last_review).toISOString() : undefined,
    },
  }));
const stats = (dev: Device) => progress(dexieSource(dev.db), now());
const plan = (dev: Device) => makePlan(dexieSource(dev.db), now());

beforeEach(() => {
  cloud = memoryTransport();
  clockMs = Date.parse("2026-09-16T08:00:00Z");
});

describe("перенос компактного прогресса между устройствами одного аккаунта", () => {
  it("второе устройство получает сроки FSRS, навыки, настройки, даты уроков, бюджет и статистику без двойного учёта", async () => {
    const phone = await device("phone", { lessons: ["lesson-1-1"] });
    const tablet = await device("tablet", { lessons: ["lesson-1-1"] });
    await saveSettings({ ...defaultSettings, timezone: "Europe/Athens", sessionSize: 6 }, phone.db);
    await saveCourseTempo(
      "leeke",
      { newItemsPerDay: 7, schedule: { startDate: "2026-09-14", weekdays: [1, 3], lessonHour: 12 } },
      new Date("2026-09-16T09:00:00Z"),
      phone.db,
    );
    await updateLesson("lesson-1-1", { targetDate: "2026-10-01" }, phone.db);
    const studied = await study(phone, [true, false, true, true, false]);
    await study(phone, [true, true, false]);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await readMeta(phone.db, META.dirty)).toBeNull();
    const status = await tablet.sync.exchange();
    expect(status.phase).toBe("synced");
    expect(status.lastConfirmedAt).toBe(now().toISOString());
    expect(await statesOf(tablet)).toEqual(await statesOf(phone));
    expect(await skillsOf(tablet, studied)).toEqual(await skillsOf(phone, studied));
    expect(await tablet.db.settings.get("settings")).toMatchObject({ timezone: "Europe/Athens", sessionSize: 6 });
    // Темп принадлежит курсу и переносится вместе с ним, иначе второе устройство считало бы дни иначе.
    expect(await tablet.db.courses.get("leeke")).toMatchObject({
      newItemsPerDay: 7,
      schedule: { startDate: "2026-09-14", weekdays: [1, 3], lessonHour: 12 },
    });
    expect((await tablet.db.lessons.get("lesson-1-1"))?.targetDate).toBe("2026-10-01");
    const [planPhone, planTablet] = await Promise.all([plan(phone), plan(tablet)]);
    expect(planTablet).toEqual(planPhone);
    const [statsPhone, statsTablet] = await Promise.all([stats(phone), stats(tablet)]);
    expect(statsTablet.days).toEqual(statsPhone.days);
    expect(statsTablet.skills).toEqual(statsPhone.skills);
    expect(statsTablet.totals).toEqual(statsPhone.totals);
    expect(statsTablet.due).toEqual(statsPhone.due);
    // Одинаковая случайность даёт одинаковое следующее занятие: выбор упражнений эквивалентен.
    const [nextPhone, nextTablet] = await Promise.all([
      makeSession({ source: dexieSource(phone.db), now: now(), random: () => 0.5 }),
      makeSession({ source: dexieSource(tablet.db), now: now(), random: () => 0.5 }),
    ]);
    expect(nextTablet.items.map((item) => [item.unitKey, item.type, item.isNew])).toEqual(
      nextPhone.items.map((item) => [item.unitKey, item.type, item.isNew]),
    );
    // Ответы после базы учитываются один раз: планшет отвечает, телефон получает ровно +2 ответа.
    await study(tablet, [true, false]);
    expect((await stats(tablet)).totals.answers).toBe(10);
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect((await stats(phone)).totals.answers).toBe(10);
    expect(await statesOf(phone)).toEqual(await statesOf(tablet));
    expect((await stats(phone)).days).toEqual((await stats(tablet)).days);
    // Повторный обмен без изменений ничего не меняет и не публикует новое поколение.
    const keys = cloud.store.size;
    await phone.sync.exchange();
    await tablet.sync.exchange();
    expect(cloud.store.size).toBe(keys);
    expect((await stats(phone)).totals.answers).toBe(10);
  });
  it("состояния слов неустановленного пакета ждут загрузки, не обнуляются и не попадают в план", async () => {
    const phone = await device("phone", { lessons: ["lesson-1-1", "lesson-1-2"] });
    const fresh = await device("fresh");
    await study(phone, [true, true, true, true]);
    await phone.sync.exchange();
    const missing: string[][] = [];
    fresh.sync.onMissingPackages = (ids) => {
      missing.push(ids);
    };
    expect((await fresh.sync.exchange()).phase).toBe("synced");
    expect(await fresh.db.cardStates.count()).toBe(0);
    expect(await fresh.db.cardStash.count()).toBe(await phone.db.cardStates.count());
    expect(missing[0]).toEqual(["lesson-1-1", "lesson-1-2"]);
    expect((await plan(fresh)).reviews).toHaveLength(0);
    const fetcher = memoryFetcher();
    await refreshCatalog(fresh.db, fetcher);
    await installLesson("lesson-1-1", fresh.db, fetcher);
    const phoneStates = await statesOf(phone);
    const adopted = await statesOf(fresh);
    expect(adopted).toEqual(phoneStates.filter((state) => state.ref.id.startsWith("w11-")));
    expect(await fresh.db.cardStash.count()).toBe(phoneStates.length - adopted.length);
    // Повторная публикация с нового устройства не теряет ещё не загруженные состояния.
    await study(fresh, [true]);
    await fresh.sync.exchange();
    expect((await phone.sync.exchange()).phase).toBe("synced");
    const merged = (await statesOf(phone)).map((state) => state.unitKey);
    expect(merged).toEqual(expect.arrayContaining(phoneStates.map((state) => state.unitKey)));
    expect(merged).toHaveLength(phoneStates.length + 1); // плюс новое слово, отвеченное на новом устройстве
  });
  it("пользовательские слова и полная история остаются локальными", async () => {
    const phone = await device("phone", { lessons: ["lesson-1-1"] });
    const own: Word = {
      id: "w-own",
      greek: "η καρέκλα",
      russian: "стул",
      ipa: "",
      segments: [],
      examples: [],
      verified: false,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    };
    const { indexWord } = await import("../src/storage/db");
    await phone.db.words.add(indexWord(own));
    await phone.db.cardStates.add(
      wordState("w-own", {
        card: {
          due: now(),
          stability: 1,
          difficulty: 5,
          elapsed_days: 0,
          scheduled_days: 1,
          reps: 1,
          lapses: 0,
          state: 2,
          learning_steps: 0,
        },
        introducedAt: now().toISOString(),
        version: 1,
      }),
    );
    await study(phone, [true, true]);
    await phone.sync.exchange();
    const tablet = await device("tablet", { lessons: ["lesson-1-1"] });
    await tablet.sync.exchange();
    expect(await tablet.db.cardStates.get(wordKeyOf("w-own"))).toBeUndefined();
    expect(await tablet.db.events.count()).toBe(0);
    expect(await tablet.db.sessions.count()).toBe(0);
    expect(await phone.db.cardStates.get(wordKeyOf("w-own"))).toBeDefined();
  });
});

describe("конфликты независимых изменений", () => {
  async function pair() {
    const phone = await device("phone", { lessons: ["lesson-1-1"], label: "ios" });
    const tablet = await device("tablet", { lessons: ["lesson-1-1"], label: "android" });
    await study(phone, [true, true, true]);
    await phone.sync.exchange();
    await tablet.sync.exchange();
    return { phone, tablet };
  }
  it("оба устройства занимались офлайн: конфликт показывает обе ветви, ничего не складывает и не перезаписывает", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [false, true]);
    await study(tablet, [true, false, true]);
    const before = await statesOf(tablet);
    await phone.sync.exchange();
    const status = await tablet.sync.exchange();
    expect(status.phase).toBe("conflict");
    expect(status.conflict?.kind).toBe("diverged");
    expect(status.conflict?.branches.map((branch) => [branch.local, branch.label])).toEqual([
      [true, "Это устройство"],
      [false, "ios"],
    ]);
    expect(status.conflict?.branches[1].description.answers).toBe(5);
    expect(await statesOf(tablet)).toEqual(before); // локальное обучение не тронуто до решения
    expect(cloud.store.has("p_" + (await tablet.sync.deviceId()))).toBe(false); // ничего не опубликовано
    // Тренировка продолжается, синхронизация успешной не считается.
    await study(tablet, [true]);
    expect((await tablet.sync.exchange()).phase).toBe("conflict");
  });
  it("выбор своей версии публикует разрешение; другое устройство с чистой базой применяет его", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [false, true]);
    await study(tablet, [true, false, true]);
    await phone.sync.exchange();
    const conflict = await tablet.sync.exchange();
    const local = conflict.conflict!.branches.find((branch) => branch.local)!;
    const resolved = await tablet.sync.resolve(local.id);
    expect(resolved.phase).toBe("synced");
    const stored = await tablet.sync.listStored();
    expect(stored.map((row) => [row.role, row.meta.device])).toEqual([["rejected", await phone.sync.deviceId()]]);
    const tabletStates = await statesOf(tablet);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await statesOf(phone)).toEqual(tabletStates);
    expect((await stats(phone)).totals).toEqual((await stats(tablet)).totals);
  });
  it("выбор чужой версии сохраняет свою как отвергнутую и не удваивает ответы", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [false, true]);
    await study(tablet, [true, false, true]);
    await phone.sync.exchange();
    const phoneStates = await statesOf(phone);
    const conflict = await tablet.sync.exchange();
    const remote = conflict.conflict!.branches.find((branch) => !branch.local)!;
    const resolved = await tablet.sync.resolve(remote.id);
    expect(resolved.phase).toBe("synced");
    expect(await statesOf(tablet)).toEqual(phoneStates);
    expect((await stats(tablet)).totals.answers).toBe(5);
    const stored = await tablet.sync.listStored();
    expect(stored).toHaveLength(1);
    expect(stored[0].role).toBe("rejected");
    expect(stored[0].snapshot.stats.answers).toBe(6);
    const exported = await tablet.sync.exportStored(stored[0].id);
    expect(JSON.parse(await exported!.text()).snapshot.stats.answers).toBe(6);
    expect(await tablet.db.events.count()).toBe(3); // собственная история устройства не удаляется, чужая не копируется
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await statesOf(phone)).toEqual(phoneStates);
  });
  it("поздняя независимая ветвь после разрешения вызывает новый конфликт, а не молчаливую перезапись", async () => {
    const { phone, tablet } = await pair();
    const laptop = await device("laptop", { lessons: ["lesson-1-1"], label: "web" });
    await laptop.sync.exchange(); // общая база у трёх устройств
    await study(phone, [false]);
    await study(tablet, [true]);
    await study(laptop, [true, true]);
    await phone.sync.exchange();
    const conflict = await tablet.sync.exchange();
    await tablet.sync.resolve(conflict.conflict!.branches.find((branch) => branch.local)!.id);
    await phone.sync.exchange();
    const late = await laptop.sync.exchange();
    expect(late.phase).toBe("conflict");
    expect(late.conflict?.branches.filter((branch) => !branch.local)).toHaveLength(1);
  });
  it("первое подключение непустой базы к непустому облаку и восстановление копии требуют выбора", async () => {
    const phone = await device("phone", { lessons: ["lesson-1-1"] });
    await study(phone, [true, true]);
    await phone.sync.exchange();
    const tablet = await device("tablet", { lessons: ["lesson-1-1"] });
    await study(tablet, [true]);
    const initial = await tablet.sync.exchange();
    expect(initial.phase).toBe("conflict");
    expect(initial.conflict?.kind).toBe("initial");
    await tablet.sync.resolve(initial.conflict!.branches.find((branch) => !branch.local)!.id);
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    // Восстановление копии отмечает базу: облако не откатывается молча.
    await writeMeta(tablet.db, META.restored, now().toISOString());
    const restored = await tablet.sync.exchange();
    expect(restored.phase).toBe("conflict");
    expect(restored.conflict?.kind).toBe("restored");
  });
  it("конфликт двух других устройств при чистой локальной базе тоже требует выбора", async () => {
    const { phone, tablet } = await pair();
    const clean = await device("clean", { lessons: ["lesson-1-1"] });
    await clean.sync.exchange();
    await study(phone, [true]);
    await study(tablet, [false]);
    await phone.sync.exchange();
    // планшет публикует без чтения телефона: эмулируем гонку прямой записью указателя другого клиента
    const adapter = kvAdapter(cloud);
    const { buildAndCommit } = await import("../src/sync/snapshot");
    const tabletDevice = await tablet.sync.deviceId();
    const snapshot = await buildAndCommit(tablet.db, now(), `${tabletDevice}-1`);
    const tabletClock = JSON.parse((await readMeta(tablet.db, META.clock))!);
    await adapter.publishVersion(
      {
        id: `${tabletDevice}-1`,
        device: tabletDevice,
        clock: { ...tabletClock, [tabletDevice]: 1 },
        createdAt: now().toISOString(),
        format: SNAPSHOT_FORMAT,
        resolves: [],
      },
      snapshot,
    );
    const status = await clean.sync.exchange();
    expect(status.phase).toBe("conflict");
    expect(status.conflict?.kind).toBe("remote");
    expect(status.conflict?.branches).toHaveLength(2);
  });
});

describe("надёжность публикации и лимиты", () => {
  it("обрыв публикации не даёт частичной версии; повтор с тем же идентификатором завершает её без удвоения", async () => {
    const phone = await device("phone", { lessons: ["lesson-1-1"] });
    const tablet = await device("tablet", { lessons: ["lesson-1-1"] });
    await study(phone, [true, true]);
    await phone.sync.exchange();
    await tablet.sync.exchange();
    await study(phone, [false, true, true]);
    let writes = 0;
    const original = cloud.setItem.bind(cloud);
    cloud.setItem = async (key, value) => {
      if (key.startsWith("v_") && ++writes === 1) throw Object.assign(new Error("сеть пропала"), { kind: "transport" });
      return original(key, value);
    };
    const failed = await phone.sync.exchange();
    expect(failed.phase).toBe("error");
    expect(failed.dirty).toBe(true);
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    expect((await stats(tablet)).totals.answers).toBe(2); // старая полная версия осталась доступной
    cloud.setItem = original;
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    expect((await stats(tablet)).totals.answers).toBe(5);
    expect(await statesOf(tablet)).toEqual(await statesOf(phone));
  });
  it("после публикации свои устаревшие поколения удаляются, чужие и сохранённые альтернативы — нет", async () => {
    const { kvAdapter: makeAdapter } = await import("../src/sync/adapter");
    const phone = await device("phone", { lessons: ["lesson-1-1"] });
    const tablet = await device("tablet", { lessons: ["lesson-1-1"] });
    await study(phone, [true]);
    await phone.sync.exchange();
    await tablet.sync.exchange();
    const phoneDevice = await phone.sync.deviceId(),
      tabletDevice = await tablet.sync.deviceId();
    await study(phone, [true]);
    await phone.sync.exchange();
    const generations = await makeAdapter(cloud).listGenerations();
    expect(generations.filter((id) => id.startsWith(phoneDevice))).toEqual([`${phoneDevice}-2`]);
    // конфликт: планшет отвергает версию телефона — она защищена от удаления телефоном? Нет: чужие ключи телефон не трогает, свои старые — только не защищённые.
    await study(tablet, [false]);
    await study(phone, [false]);
    await phone.sync.exchange();
    const conflict = await tablet.sync.exchange();
    await tablet.sync.resolve(conflict.conflict!.branches.find((branch) => branch.local)!.id);
    const after = await makeAdapter(cloud).listGenerations();
    expect(after).toContain(`${tabletDevice}-1`);
    expect(after).toContain(`${phoneDevice}-3`); // чужое поколение не удалено планшетом
  });
  it("нехватка места останавливает облачную запись, сохраняет очередь и локальные данные", async () => {
    cloud = memoryTransport({ limits: { maxKeys: 1 } }); // одна часть плюс указатель уже не помещаются
    const phone = await device("phone", { lessons: ["lesson-1-1", "lesson-1-2", "lesson-1-3", "lesson-1-4"] });
    await study(phone, [true, true, true, true, true, true]);
    const before = await statesOf(phone);
    const status = await phone.sync.exchange();
    expect(status.phase).toBe("error");
    expect(status.error?.kind).toBe("limit");
    expect(status.dirty).toBe(true);
    expect(await statesOf(phone)).toEqual(before);
    expect(cloud.store.size).toBe(0);
    expect(await readMeta(phone.db, META.dirty)).toBe("1");
    // Место появилось — тот же прогресс публикуется, без удвоения.
    cloud.limits.maxKeys = 1024;
    expect((await phone.sync.exchange()).phase).toBe("synced");
    const tablet = await device("tablet", { lessons: ["lesson-1-1", "lesson-1-2", "lesson-1-3", "lesson-1-4"] });
    await tablet.sync.exchange();
    expect((await stats(tablet)).totals.answers).toBe(6);
  });
  it("версия более нового формата не применяется, не перезаписывается и просит обновить приложение", async () => {
    const phone = await device("phone", { lessons: ["lesson-1-1"] });
    await study(phone, [true]);
    await phone.sync.exchange();
    const tablet = await device("tablet", { lessons: ["lesson-1-1"] });
    await tablet.sync.exchange();
    const phoneDevice = await phone.sync.deviceId();
    const pointer = JSON.parse(cloud.store.get(`p_${phoneDevice}`)!);
    cloud.store.set(
      `p_${phoneDevice}`,
      JSON.stringify({ ...pointer, id: `${phoneDevice}-9`, format: SNAPSHOT_FORMAT + 1, clock: { [phoneDevice]: 9 } }),
    );
    await study(tablet, [false]);
    const before = await statesOf(tablet);
    const status = await tablet.sync.exchange();
    expect(status.phase).toBe("error");
    expect(status.error?.kind).toBe("format");
    expect(status.error?.message).toMatch(/Обновите приложение/);
    expect(await statesOf(tablet)).toEqual(before);
    expect(cloud.store.has(`p_${await tablet.sync.deviceId()}`)).toBe(false); // планшет ничего не опубликовал поверх неизвестного формата
    expect(await readMeta(tablet.db, META.dirty)).toBe("1");
  });
  it("вторая вкладка не пишет параллельно, а без блокировок запись приостанавливается", async () => {
    const db = new LexiDatabase(`lexi-sync-tabs-${++counter}`);
    await db.delete();
    await db.open();
    await installLessons(db, ["lesson-1-1"]);
    const busy = new SyncCoordinator({
      database: db,
      adapter: kvAdapter(cloud),
      now,
      lock: async () => "busy",
      schedule: () => () => undefined,
    });
    await study({ db, sync: busy, name: "tabs" }, [true]);
    expect((await busy.exchange()).phase).toBe("paused");
    expect(cloud.store.size).toBe(0);
    const unsupported = new SyncCoordinator({
      database: db,
      adapter: kvAdapter(cloud),
      now,
      lock: async () => "unsupported",
      schedule: () => () => undefined,
    });
    const status = await unsupported.exchange();
    expect(status.phase).toBe("paused");
    expect(status.reason).toMatch(/приостановлена/);
    expect(cloud.store.size).toBe(0);
    expect(await readMeta(db, META.dirty)).toBe("1");
  });
  it("ошибка CloudStorage не показывается успехом, повтор планируется с задержкой", async () => {
    const delays: number[] = [];
    const db = new LexiDatabase(`lexi-sync-err-${++counter}`);
    await db.delete();
    await db.open();
    await installLessons(db, ["lesson-1-1"]);
    const broken = memoryTransport({
      intercept: (op) => {
        if (op === "getKeys") throw Object.assign(new Error("CloudStorage timeout"), { kind: "transport" });
      },
    });
    const sync = new SyncCoordinator({
      database: db,
      adapter: kvAdapter(broken),
      now,
      schedule: (_, delay) => {
        delays.push(delay);
        return () => undefined;
      },
      retryBaseMs: 1000,
    });
    await study({ db, sync, name: "err" }, [true]);
    const first = await sync.exchange();
    expect(first.phase).toBe("error");
    expect(first.lastConfirmedAt).toBeNull();
    await sync.exchange();
    expect(delays).toEqual([1000, 2000]);
  });
  it("обычный браузер: синхронизация отключена явно, CloudStorage не вызывается", async () => {
    const db = new LexiDatabase(`lexi-sync-web-${++counter}`);
    await db.delete();
    await db.open();
    const sync = new SyncCoordinator({
      database: db,
      adapter: kvAdapter(disabledTransport()),
      now,
      schedule: () => () => undefined,
    });
    expect((await sync.exchange()).phase).toBe("disabled");
    expect(
      profileFor({
        kind: "web",
        bot: "TaveloriBot",
        platform: null,
        version: null,
        user: null,
        startParam: null,
        launchId: null,
      }),
    ).toMatchObject({ databaseName: "lexi", syncable: false });
  });
});

describe("изоляция профилей", () => {
  it("разные аккаунты и боты получают разные базы; без контекста облачная запись не ведётся", () => {
    const user = (id: number) => ({ id, firstName: "A" });
    const main = profileFor({
      kind: "telegram",
      bot: "TaveloriBot",
      platform: "ios",
      version: "8.0",
      user: user(1),
      startParam: null,
      launchId: null,
    });
    const other = profileFor({
      kind: "telegram",
      bot: "TaveloriBot",
      platform: "ios",
      version: "8.0",
      user: user(2),
      startParam: null,
      launchId: null,
    });
    const dev = profileFor({
      kind: "telegram",
      bot: "TaveloriDevBot",
      platform: "ios",
      version: "8.0",
      user: user(1),
      startParam: null,
      launchId: null,
    });
    const anonymous = profileFor({
      kind: "telegram",
      bot: "TaveloriBot",
      platform: "ios",
      version: "8.0",
      user: null,
      startParam: null,
      launchId: null,
    });
    expect(
      new Set([main.databaseName, other.databaseName, dev.databaseName, anonymous.databaseName, "lexi"]).size,
    ).toBe(5);
    expect(main.syncable).toBe(true);
    expect(anonymous.syncable).toBe(false);
    expect(main.databaseName).toBe("lexi-tg-TaveloriBot-1");
  });
});
