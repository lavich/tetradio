import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import Dexie from "dexie";
import { markChanged } from "../src/storage/ops";
import { buildAndCommit, submitAnswer } from "./helpers/ops";
import { makePlan, makeSession } from "../src/domain/learning";
import { progress } from "../src/domain/stats";
import { kvAdapter } from "../src/sync/adapter";
import { SyncCoordinator, type CoordinatorOptions } from "../src/sync/coordinator";
import { memoryTransport, disabledTransport, type MemoryTransport } from "../src/sync/transport";
import { META, readMeta, writeMeta } from "../src/sync/snapshot";
import { SNAPSHOT_FORMAT } from "../src/sync/types";
import { installCompleted, installLessons, memoryFetcher, packageOf } from "./helpers/content";
import { installLesson, refreshCatalog } from "../src/content/client";
import type { Word } from "../src/domain/types";
import { wordKeyOf, wordRef, wordState } from "./helpers/cards";
import { FORMAT5_BUILD, loadBuild, ROLLBACK_BUILD } from "./helpers/builds";

const lifecycle = vi.hoisted(() => vi.fn());
vi.mock("../src/reporting/reporting", async (original) => ({
  ...(await original<typeof import("../src/reporting/reporting")>()),
  lifecycle,
}));

let cloud: MemoryTransport;
let clockMs = Date.parse("2026-09-16T08:00:00Z");
const tick = (minutes = 1) => {
  clockMs += minutes * 60000;
  return new Date(clockMs);
};
const now = () => new Date(clockMs);
let counter = 0;
type Build = Awaited<ReturnType<typeof loadBuild>>;
async function device(
  name: string,
  options: { lessons?: string[]; label?: string; maxKeys?: number; build?: Build; db?: AppDatabase } & Pick<
    CoordinatorOptions,
    "lock" | "online"
  > = {},
) {
  const build = options.build ?? { SyncCoordinator, kvAdapter };
  const db = options.db ?? new AppDatabase(`tetradio-sync-${name}-${++counter}`);
  if (!options.db) {
    await db.delete();
    await db.open();
  }
  if (options.lessons) await installCompleted(db, options.lessons);
  const sync = new build.SyncCoordinator({
    database: db,
    adapter: build.kvAdapter(cloud),
    now,
    label: options.label ?? name,
    schedule: () => () => undefined,
    retryBaseMs: 1,
    ...(options.lock ? { lock: options.lock } : {}),
    ...(options.online ? { online: options.online } : {}),
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
  it("второе устройство получает сроки FSRS, навыки, пройденные уроки и статистику без двойного учёта", async () => {
    const phone = await device("phone", { lessons: ["mech-1"] });
    const tablet = await device("tablet", { lessons: ["mech-1"] });
    await installLessons(phone.db, ["mech-2"]);
    await installLessons(tablet.db, ["mech-2"]);
    await phone.db.lessons.update("mech-2", { completed: true, updatedAt: "2026-09-16T07:00:00.000Z" });
    const studied = await study(phone, [true, false, true, true, false]);
    await study(phone, [true, true, false]);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await readMeta(phone.db, META.dirty)).toBeNull();
    const status = await tablet.sync.exchange();
    expect(status.phase).toBe("synced");
    expect(status.lastConfirmedAt).toBe(now().toISOString());
    expect(await statesOf(tablet)).toEqual(await statesOf(phone));
    expect(await skillsOf(tablet, studied)).toEqual(await skillsOf(phone, studied));
    expect(await tablet.db.lessons.get("mech-2")).toMatchObject({
      completed: true,
      updatedAt: "2026-09-16T07:00:00.000Z",
    });
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
    const phone = await device("phone", { lessons: ["mech-1", "mech-2"] });
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
    expect(missing[0]).toEqual(["mech-1", "mech-2"]);
    expect((await plan(fresh)).reviews).toHaveLength(0);
    const fetcher = memoryFetcher();
    await refreshCatalog(fresh.db, fetcher);
    await installLesson("mech-1", fresh.db, fetcher);
    const phoneStates = await statesOf(phone);
    const adopted = await statesOf(fresh);
    const first = new Set(packageOf("mech-1").items.map((item) => item.id));
    expect(adopted).toEqual(phoneStates.filter((state) => first.has(state.ref.id)));
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
    const phone = await device("phone", { lessons: ["mech-1"] });
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
    const tablet = await device("tablet", { lessons: ["mech-1"] });
    await tablet.sync.exchange();
    expect(await tablet.db.cardStates.get(wordKeyOf("w-own"))).toBeUndefined();
    expect(await tablet.db.events.count()).toBe(0);
    expect(await tablet.db.sessions.count()).toBe(0);
    expect(await phone.db.cardStates.get(wordKeyOf("w-own"))).toBeDefined();
  });
});

describe("конфликты независимых изменений", () => {
  async function pair() {
    const phone = await device("phone", { lessons: ["mech-1"], label: "ios" });
    const tablet = await device("tablet", { lessons: ["mech-1"], label: "android" });
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
  it("ответ, записанный во время применения выбранной облачной версии, остаётся неопубликованным изменением", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [false, true]);
    await study(tablet, [true, false, true]);
    await phone.sync.exchange();
    const conflict = await tablet.sync.exchange();
    const remote = conflict.conflict!.branches.find((branch) => !branch.local)!;
    const answered: Promise<unknown>[] = [];
    const answer = () => {
      // Запись встаёт в очередь за транзакцией применения и выполняется раньше следующего чтения координатора.
      if (!answered.length) answered.push(Dexie.ignoreTransaction(() => markChanged(tablet.db)));
    };
    tablet.db.baseSummary.hook("creating", answer);
    tablet.db.baseSummary.hook("updating", answer);
    const resolved = await tablet.sync.resolve(remote.id);
    tablet.db.baseSummary.hook("creating").unsubscribe(answer);
    tablet.db.baseSummary.hook("updating").unsubscribe(answer);
    expect(answered).toHaveLength(1);
    await Promise.all(answered);
    expect(resolved.phase).toBe("synced");
    expect(await readMeta(tablet.db, META.dirty)).not.toBeNull();
    expect(resolved.dirty).toBe(true);
  });
  it("выбор чужой версии снимает завершение уроков, которых в ней нет, как и их блоки", async () => {
    const { phone, tablet } = await pair();
    await installCompleted(tablet.db, ["mech-2"]);
    await study(phone, [false, true]);
    await study(tablet, [true, false, true]);
    await phone.sync.exchange();
    const conflict = await tablet.sync.exchange();
    await tablet.sync.resolve(conflict.conflict!.branches.find((branch) => !branch.local)!.id);
    expect(await tablet.db.lessons.get("mech-2")).toMatchObject({ completed: false, updatedAt: now().toISOString() });
    expect((await tablet.db.lessons.get("mech-1"))?.completed).toBe(true);
    const [stored] = await tablet.sync.listStored();
    expect(stored.snapshot.lessons.find((lesson) => lesson.id === "mech-2")?.completed).toBe(true);
  });
  it("два устройства опубликовали почти одновременно: чистое устройство не принимает чужую версию молча", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [true, false]);
    await phone.sync.exchange();
    // Планшет публикует, не успев увидеть версию телефона: её ключи на время скрыты.
    const hidden = new Map([...cloud.store].filter(([key]) => !key.startsWith("p_") || key.includes("tablet")));
    const phoneKeys = new Map([...cloud.store].filter(([key]) => !hidden.has(key)));
    for (const key of phoneKeys.keys()) cloud.store.delete(key);
    await study(tablet, [true, true, true]);
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    for (const [key, value] of phoneKeys) cloud.store.set(key, value);
    const phoneStates = await statesOf(phone);
    const result = await phone.sync.exchange();
    expect(result.phase).toBe("conflict");
    expect(result.conflict?.kind).toBe("diverged");
    expect(result.conflict?.branches.some((branch) => branch.local)).toBe(true);
    expect(await statesOf(phone)).toEqual(phoneStates); // ответы телефона на месте до выбора
  });
  it("ответы, данные после обнаружения конфликта, входят в сохранённую отвергнутую версию", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [true]);
    await study(tablet, [true, true]);
    await phone.sync.exchange();
    const conflict = await tablet.sync.exchange();
    const before = conflict.conflict!.branches.find((branch) => branch.local)!.snapshot.stats.answers;
    await study(tablet, [true]);
    await tablet.sync.resolve(conflict.conflict!.branches.find((branch) => !branch.local)!.id);
    const [stored] = await tablet.sync.listStored();
    expect(stored.snapshot.stats.answers).toBe(before + 1);
  });
  it("выбор версии не идёт параллельно с фоновым обменом", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [false, true]);
    await study(tablet, [true, false, true]);
    await phone.sync.exchange();
    const conflict = await tablet.sync.exchange();
    const local = conflict.conflict!.branches.find((branch) => branch.local)!;
    const [first, second] = await Promise.all([tablet.sync.resolve(local.id), tablet.sync.exchange()]);
    expect(first.phase).toBe("synced");
    expect(second.phase).toBe("synced");
    const pointers = [...cloud.store.keys()].filter((key) => key.startsWith("p_"));
    expect(new Set(pointers).size).toBe(pointers.length);
    expect((await phone.sync.exchange()).phase).toBe("synced");
  });
  it("выбор исчезнувшей версии не роняет ни выбор, ни обмен, ожидающий его", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [false]);
    await study(tablet, [true]);
    await phone.sync.exchange();
    expect((await tablet.sync.exchange()).phase).toBe("conflict");
    const choice = tablet.sync.resolve("gone");
    const waiting = tablet.sync.exchange();
    await expect(choice).resolves.toMatchObject({ phase: "conflict" });
    await expect(waiting).resolves.toMatchObject({ phase: "conflict" });
  });
  it("выбор исчезнувшей версии просит выбрать ещё раз; следующий выбор снимает просьбу", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [false]);
    await study(tablet, [true]);
    await phone.sync.exchange();
    const conflict = await tablet.sync.exchange();
    const stale = await tablet.sync.resolve("gone");
    expect(stale).toMatchObject({ phase: "conflict", reason: "Версии изменились — выберите ещё раз." });
    const local = conflict.conflict!.branches.find((branch) => branch.local)!;
    const choice = tablet.sync.resolve(local.id);
    expect(tablet.sync.getStatus().reason).toBeNull();
    expect(await choice).toMatchObject({ phase: "synced", reason: null });
  });
  it("закрытие окна выбора снимает причины выбора; вне конфликта причина занятой вкладки остаётся", async () => {
    let busy = false;
    const phone = await device("phone", { lessons: ["mech-1"], label: "ios" });
    const tablet = await device("tablet", {
      lessons: ["mech-1"],
      lock: async (run) => (busy ? "busy" : (await run(), "acquired")),
    });
    await study(phone, [true]);
    await phone.sync.exchange();
    await study(tablet, [true]);
    const conflict = await tablet.sync.exchange();
    expect(conflict.phase).toBe("conflict");
    await tablet.sync.resolve("gone");
    tablet.sync.dismissChoice();
    expect(tablet.sync.getStatus()).toMatchObject({ phase: "conflict", reason: null });
    busy = true;
    expect((await tablet.sync.resolve(conflict.conflict!.branches[0].id)).reason).toContain("другая вкладка");
    tablet.sync.dismissChoice();
    expect(tablet.sync.getStatus()).toMatchObject({ phase: "conflict", reason: null });
    const otherTab = new SyncCoordinator({
      database: tablet.db,
      adapter: kvAdapter(cloud),
      now,
      lock: async () => "busy",
      schedule: () => () => undefined,
    });
    const { reason } = await otherTab.exchange();
    expect(reason).toContain("другая вкладка");
    otherTab.dismissChoice();
    expect(otherTab.getStatus().reason).toBe(reason);
  });
  it("сбой обмена снимает просьбу выбрать ещё раз", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [false]);
    await study(tablet, [true]);
    await phone.sync.exchange();
    await tablet.sync.exchange();
    expect((await tablet.sync.resolve("gone")).reason).toMatch(/Версии изменились/);
    tablet.db.close();
    expect(await tablet.sync.exchange()).toMatchObject({ phase: "error", reason: null });
  });
  it("без блокировок вкладок прежняя причина «Нет сети» не остаётся в окне конфликта", async () => {
    let online = false;
    const phone = await device("phone", { lessons: ["mech-1"], label: "ios" });
    const tablet = await device("tablet", {
      lessons: ["mech-1"],
      lock: async () => "unsupported",
      online: () => online,
    });
    await study(phone, [true]);
    await phone.sync.exchange();
    await study(tablet, [true]);
    expect((await tablet.sync.exchange()).reason).toMatch(/Нет сети/);
    online = true;
    expect(await tablet.sync.exchange()).toMatchObject({ phase: "conflict", reason: null });
  });
  it("изменение во время выбора версии публикуется следующим обменом сразу после выбора", async () => {
    let during: (() => Promise<void>) | null = null;
    cloud = memoryTransport({
      intercept: async (op, key) => {
        if (op !== "setItem" || !key?.startsWith("p_") || !during) return;
        const run = during;
        during = null;
        await run();
      },
    });
    const { phone, tablet } = await pair();
    await study(phone, [false]);
    await study(tablet, [true]);
    await phone.sync.exchange();
    const conflict = await tablet.sync.exchange();
    during = async () => {
      await study(tablet, [true]);
      void tablet.sync.exchange();
    };
    const resolved = await tablet.sync.resolve(conflict.conflict!.branches.find((branch) => branch.local)!.id);
    expect(during).toBeNull();
    expect(resolved.phase).toBe("synced");
    await vi.waitFor(async () => expect(await readMeta(tablet.db, META.dirty)).toBeNull());
  });
  it("поздняя независимая ветвь после разрешения вызывает новый конфликт, а не молчаливую перезапись", async () => {
    const { phone, tablet } = await pair();
    const laptop = await device("laptop", { lessons: ["mech-1"], label: "web" });
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
    const phone = await device("phone", { lessons: ["mech-1"] });
    await study(phone, [true, true]);
    await phone.sync.exchange();
    const tablet = await device("tablet", { lessons: ["mech-1"] });
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
  it("ответ, сохранённый во время сборки снимка, учитывается в сводке один раз", async () => {
    const phone = await device("phone", { lessons: ["mech-1"] });
    const cutoff = new Date(clockMs + 150_000); // между первым ответом (+2 мин) и вторым (+3 мин)
    await study(phone, [true, true]);
    // Публикация взяла «сейчас» до второго ответа, а сводку собрала уже после него.
    expect((await buildAndCommit(phone.db, cutoff, "phone-1")).stats.answers).toBe(1);
    expect((await buildAndCommit(phone.db, tick(), "phone-2")).stats.answers).toBe(2);
    expect(await phone.db.events.count()).toBe(2);
  });
  it("конфликт двух других устройств при чистой локальной базе тоже требует выбора", async () => {
    const { phone, tablet } = await pair();
    const clean = await device("clean", { lessons: ["mech-1"] });
    await clean.sync.exchange();
    await study(phone, [true]);
    await study(tablet, [false]);
    await phone.sync.exchange();
    // планшет публикует без чтения телефона: эмулируем гонку прямой записью указателя другого клиента
    const adapter = kvAdapter(cloud);
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
    const phone = await device("phone", { lessons: ["mech-1"] });
    const tablet = await device("tablet", { lessons: ["mech-1"] });
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
    const phone = await device("phone", { lessons: ["mech-1"] });
    const tablet = await device("tablet", { lessons: ["mech-1"] });
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
  it("хранятся пять последних отвергнутых версий, старшие удаляются при следующей публикации", async () => {
    const phone = await device("phone", { lessons: ["mech-1"] });
    await study(phone, [true]);
    await phone.sync.exchange();
    const pointer = (await kvAdapter(cloud).listPointers()).pointers[0];
    const snapshot = await kvAdapter(cloud).readVersion(pointer);
    await phone.db.syncVersions.bulkPut(
      Array.from({ length: 7 }, (_, index) => ({
        id: `old-${index}`,
        role: "rejected" as const,
        createdAt: `2026-09-0${index + 1}T00:00:00.000Z`,
        meta: { ...pointer, id: `old-${index}` },
        snapshot,
      })),
    );
    await study(phone, [false]);
    await phone.sync.exchange();
    expect((await phone.sync.listStored()).map((row) => row.id)).toEqual(["old-6", "old-5", "old-4", "old-3", "old-2"]);
  });
  it("своё поколение, сохранённое как отвергнутая версия, уборка не удаляет", async () => {
    const phone = await device("phone", { lessons: ["mech-1"] });
    await study(phone, [true]);
    await phone.sync.exchange();
    const phoneDevice = await phone.sync.deviceId();
    const pointer = (await kvAdapter(cloud).listPointers()).pointers[0];
    await phone.db.syncVersions.put({
      id: pointer.id,
      role: "rejected",
      createdAt: now().toISOString(),
      meta: pointer,
      snapshot: await kvAdapter(cloud).readVersion(pointer),
      note: "",
    });
    await study(phone, [false]);
    await phone.sync.exchange();
    await study(phone, [true]);
    await phone.sync.exchange();
    const generations = await kvAdapter(cloud).listGenerations();
    expect(generations.filter((id) => id.startsWith(`${phoneDevice}-`)).sort()).toEqual([
      `${phoneDevice}-1`,
      `${phoneDevice}-3`,
    ]);
  });
  it("указатель другого устройства, вошедший в принятую версию, удаляется с частями через 30 дней, не раньше", async () => {
    const phone = await device("phone", { lessons: ["mech-1"] });
    const tablet = await device("tablet", { lessons: ["mech-1"] });
    await study(phone, [true, true]);
    await phone.sync.exchange();
    await tablet.sync.exchange();
    const phoneDevice = await phone.sync.deviceId();
    const phoneKeys = () =>
      [...cloud.store.keys()].filter((key) => key === `p_${phoneDevice}` || key.startsWith(`v_${phoneDevice}-`));
    await study(tablet, [true]);
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    expect(phoneKeys()).toContain(`p_${phoneDevice}`); // моложе 30 дней
    tick(31 * 24 * 60);
    await study(tablet, [false]);
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    expect(phoneKeys()).toEqual([]);
    // Устройство возвращается: принимает общую версию и публикует дальше как обычно.
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await statesOf(phone)).toEqual(await statesOf(tablet));
    await study(phone, [true]);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    expect(await statesOf(tablet)).toEqual(await statesOf(phone));
  });
  it("указатель устройства убрала чужая уборка — следующий обмен выпускает версию снова", async () => {
    const phone = await device("phone", { lessons: ["mech-1"] });
    const tablet = await device("tablet", { lessons: ["mech-1"] });
    await study(phone, [true, true]);
    await phone.sync.exchange();
    await tablet.sync.exchange();
    const phoneDevice = await phone.sync.deviceId();
    const pointer = (await kvAdapter(cloud).listPointers()).pointers.find((item) => item.device === phoneDevice)!;
    expect(await kvAdapter(cloud).removeDevice(pointer)).toBe(true);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(cloud.store.has(`p_${phoneDevice}`)).toBe(true);
    const fresh = await device("fresh", { lessons: ["mech-1"] });
    expect((await fresh.sync.exchange()).phase).toBe("synced");
    expect((await stats(fresh)).totals.answers).toBe(2);
  });
  it("старый указатель, не вошедший в принятую версию, не удаляется", async () => {
    const phone = await device("phone", { lessons: ["mech-1"] });
    await study(phone, [true]);
    await phone.sync.exchange();
    const phoneDevice = await phone.sync.deviceId();
    const ghost = (await import("../src/sync/snapshot")).readSnapshot(phone.db, now());
    let inject = true;
    const original = cloud.setItem.bind(cloud);
    cloud.setItem = async (key, value) => {
      // Другое устройство публикует во время нашей выгрузки: уборка видит его, а принятая версия — нет.
      if (inject && key === `p_${phoneDevice}`) {
        inject = false;
        await kvAdapter(cloud).publishVersion(
          {
            id: "ghost-1",
            device: "ghost",
            clock: { ghost: 1 },
            createdAt: "2026-01-01T00:00:00.000Z",
            format: SNAPSHOT_FORMAT,
            resolves: [],
          },
          await ghost,
        );
      }
      return original(key, value);
    };
    tick(31 * 24 * 60);
    await study(phone, [false]);
    await phone.sync.exchange();
    expect(cloud.store.has("p_ghost")).toBe(true);
    expect([...cloud.store.keys()].some((key) => key.startsWith("v_ghost-1_"))).toBe(true);
  });
  it("нехватка места: уборка вошедших в принятую версию указателей сразу, без учёта возраста, и повтор", async () => {
    const phone = await device("phone", { lessons: ["mech-1"] });
    const tablet = await device("tablet", { lessons: ["mech-1"] });
    await study(phone, [true, true]);
    await phone.sync.exchange();
    await tablet.sync.exchange();
    const phoneDevice = await phone.sync.deviceId();
    cloud.limits.maxKeys = cloud.store.size + 1;
    await study(tablet, [true]);
    const status = await tablet.sync.exchange();
    expect(status.phase).toBe("synced");
    expect(cloud.store.has(`p_${phoneDevice}`)).toBe(false);
    expect(cloud.store.has(`p_${await tablet.sync.deviceId()}`)).toBe(true);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await statesOf(phone)).toEqual(await statesOf(tablet));
  });
  it("нехватка места останавливает облачную запись, сохраняет очередь и локальные данные", async () => {
    cloud = memoryTransport({ limits: { maxKeys: 1 } }); // одна часть плюс указатель уже не помещаются
    const phone = await device("phone", { lessons: ["mech-1", "mech-2", "mech-3", "mech-4"] });
    await study(phone, [true, true, true, true, true, true]);
    const before = await statesOf(phone);
    const status = await phone.sync.exchange();
    expect(status.phase).toBe("error");
    expect(status.error?.kind).toBe("limit");
    expect(status.dirty).toBe(true);
    expect(await statesOf(phone)).toEqual(before);
    expect(cloud.store.size).toBe(0);
    expect(await readMeta(phone.db, META.dirty)).toBeTruthy();
    // Место появилось — тот же прогресс публикуется, без удвоения.
    cloud.limits.maxKeys = 1024;
    expect((await phone.sync.exchange()).phase).toBe("synced");
    const tablet = await device("tablet", { lessons: ["mech-1", "mech-2", "mech-3", "mech-4"] });
    await tablet.sync.exchange();
    expect((await stats(tablet)).totals.answers).toBe(6);
  });
  it("версия более нового формата не применяется, не перезаписывается и просит обновить приложение", async () => {
    const phone = await device("phone", { lessons: ["mech-1"] });
    await study(phone, [true]);
    await phone.sync.exchange();
    const tablet = await device("tablet", { lessons: ["mech-1"] });
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
    expect(await readMeta(tablet.db, META.dirty)).toBeTruthy();
  });
  it("вторая вкладка не пишет параллельно, а без блокировок запись приостанавливается", async () => {
    const db = new AppDatabase(`tetradio-sync-tabs-${++counter}`);
    await db.delete();
    await db.open();
    await installCompleted(db, ["mech-1"]);
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
    expect(await readMeta(db, META.dirty)).toBeTruthy();
  });
  it("ошибка CloudStorage не показывается успехом, повтор планируется с задержкой", async () => {
    const delays: number[] = [];
    const db = new AppDatabase(`tetradio-sync-err-${++counter}`);
    await db.delete();
    await db.open();
    await installCompleted(db, ["mech-1"]);
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
    const db = new AppDatabase(`tetradio-sync-web-${++counter}`);
    await db.delete();
    await db.open();
    const sync = new SyncCoordinator({
      database: db,
      adapter: kvAdapter(disabledTransport()),
      now,
      schedule: () => () => undefined,
    });
    expect((await sync.exchange()).phase).toBe("disabled");
  });
});

describe("крошка публикации", () => {
  const published = () => lifecycle.mock.calls.filter(([message]) => message === "syncPublished");

  it("после записи указателя — одна крошка с форматом, числом частей и длиной записанного текста", async () => {
    lifecycle.mockClear();
    const phone = await device("phone", { lessons: ["mech-1"] });
    await study(phone, [true, false, true]);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    const pointer = JSON.parse(cloud.store.get(`p_${await phone.sync.deviceId()}`)!);
    const text = Array.from({ length: pointer.parts }, (_, index) => cloud.store.get(`v_${pointer.id}_${index}`)).join(
      "",
    );
    expect(published()).toEqual([
      ["syncPublished", { ms: expect.any(Number), parts: pointer.parts, chars: text.length, format: pointer.format }],
    ]);
  });
  it("при нехватке места крошки нет", async () => {
    lifecycle.mockClear();
    cloud = memoryTransport({ limits: { maxKeys: 1 } });
    const phone = await device("phone", { lessons: ["mech-1"] });
    await study(phone, [true, false, true]);
    expect((await phone.sync.exchange()).error).toMatchObject({ kind: "limit" });
    expect(published()).toEqual([]);
  });
});

describe("согласование формата записи", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const pointerOf = async (dev: Device) => JSON.parse(cloud.store.get(`p_${await dev.sync.deviceId()}`)!);
  const partsOf = (id: string) => [...cloud.store.keys()].filter((key) => key.startsWith(`v_${id}_`));
  const phases: string[] = [];
  const exchange = async (dev: Device) => {
    const status = await dev.sync.exchange();
    phases.push(status.phase);
    return status;
  };
  const turn = async (dev: Device, answers: boolean[]) => {
    await exchange(dev);
    await study(dev, answers);
    return exchange(dev);
  };
  beforeEach(() => {
    phases.length = 0;
  });

  it("смешанные устройства: новое пишет формат 5, прежнее применяет его, ни конфликта, ни ошибки формата", async () => {
    const legacy = await loadBuild(FORMAT5_BUILD);
    const old = await device("old", { lessons: ["mech-1"], build: legacy });
    const fresh = await device("fresh", { lessons: ["mech-1"] });
    await turn(old, [true, false]);
    await turn(fresh, [true]);
    expect(await pointerOf(fresh)).toMatchObject({ format: 5, reads: [3, 4, 5, 6] });
    await turn(old, [false]);
    await turn(fresh, [true, true]);
    await exchange(old);
    expect((await pointerOf(fresh)).format).toBe(5);
    expect((await pointerOf(old)).reads).toBeUndefined();
    expect(phases.every((phase) => phase === "synced")).toBe(true);
    expect(await statesOf(old)).toEqual(await statesOf(fresh));
  });
  it("после обновления прежнее устройство объявляет чтение 6 одним указателем, и следующая публикация — формат 6", async () => {
    const legacy = await loadBuild(FORMAT5_BUILD);
    const old = await device("old", { lessons: ["mech-1"], build: legacy });
    const fresh = await device("fresh", { lessons: ["mech-1"] });
    await turn(old, [true, false]);
    await turn(fresh, [true]);
    const freshFive = (await pointerOf(fresh)).id;
    const before = await pointerOf(old);
    const keys = [...cloud.store.keys()].sort();
    const updated = await device("old", { db: old.db });
    await exchange(updated);
    const after = await pointerOf(updated);
    expect(after).toEqual({ ...before, reads: [3, 4, 5, 6] });
    expect([...cloud.store.keys()].sort()).toEqual(keys);
    lifecycle.mockClear();
    await turn(fresh, [false, true]);
    const six = await pointerOf(fresh);
    expect(six.format).toBe(6);
    expect(lifecycle.mock.calls.filter(([message]) => message === "syncPublished")).toEqual([
      ["syncPublished", expect.objectContaining({ format: 6, parts: six.parts })],
    ]);
    expect(partsOf(freshFive)).toEqual([]);
    expect((await exchange(updated)).phase).toBe("synced");
    expect(await statesOf(updated)).toEqual(await statesOf(fresh));
    const [statsOld, statsFresh] = await Promise.all([stats(updated), stats(fresh)]);
    expect(statsOld.totals).toEqual(statsFresh.totals);
    expect(statsOld.days).toEqual(statsFresh.days);
    expect(phases.every((phase) => phase === "synced")).toBe(true);
  });
  it("указатель без чтения 6, не менявшийся больше 30 дней по местным часам, не мешает формату 6", async () => {
    const legacy = await loadBuild(FORMAT5_BUILD);
    const old = await device("old", { lessons: ["mech-1"], build: legacy });
    const fresh = await device("fresh", { lessons: ["mech-1"] });
    await turn(old, [true]);
    await turn(fresh, [true]);
    expect((await pointerOf(fresh)).format).toBe(5);
    clockMs += 31 * DAY;
    await turn(fresh, [false]);
    expect((await pointerOf(fresh)).format).toBe(6);
  });
  it("указатель активного прежнего устройства пропал из облака — новое всё равно пишет 5", async () => {
    const legacy = await loadBuild(FORMAT5_BUILD);
    const old = await device("old", { lessons: ["mech-1"], build: legacy });
    const fresh = await device("fresh", { lessons: ["mech-1"] });
    await turn(old, [true]);
    await exchange(fresh);
    const gone = await pointerOf(old);
    cloud.store.delete(`p_${gone.device}`);
    for (const key of partsOf(gone.id)) cloud.store.delete(key);
    await study(fresh, [true]);
    await exchange(fresh);
    expect((await pointerOf(fresh)).format).toBe(5);
  });
  it("уборка при нехватке места не удаляет указатель активного устройства без чтения 6", async () => {
    const legacy = await loadBuild(FORMAT5_BUILD);
    const old = await device("old", { lessons: ["mech-1"], build: legacy });
    const fresh = await device("fresh", { lessons: ["mech-1"] });
    await turn(old, [true]);
    await exchange(fresh);
    await study(fresh, [true]);
    cloud.limits.maxKeys = cloud.store.size + 1;
    expect((await fresh.sync.exchange()).error).toMatchObject({ kind: "limit" });
    expect(cloud.store.has(`p_${await old.sync.deviceId()}`)).toBe(true);
  });
  it.each([
    ["на 40 дней в прошлом", (at: number) => new Date(at - 40 * DAY).toISOString()],
    ["пустым", () => ""],
  ])("указатель прежнего устройства со временем %s, увиденный впервые, считается свежим", async (_, createdAt) => {
    const legacy = await loadBuild(FORMAT5_BUILD);
    const old = await device("old", { lessons: ["mech-1"], build: legacy });
    await turn(old, [true]);
    const raw = await pointerOf(old);
    cloud.store.set(`p_${raw.device}`, JSON.stringify({ ...raw, createdAt: createdAt(clockMs) }));
    const fresh = await device("fresh", { lessons: ["mech-1"] });
    await turn(fresh, [true]);
    expect((await pointerOf(fresh)).format).toBe(5);
  });
  it("выбор версии в конфликте решает формат по свежему чтению облака", async () => {
    const one = await device("one", { lessons: ["mech-1"] });
    const two = await device("two", { lessons: ["mech-1"] });
    await turn(one, [true]);
    await turn(two, [true]);
    await turn(one, [false]);
    await study(two, [true, true]);
    const conflict = await two.sync.exchange();
    expect(conflict.phase).toBe("conflict");
    const legacy = await loadBuild(FORMAT5_BUILD);
    const snapshot = await buildAndCommit(one.db, now(), "old-1");
    await legacy
      .kvAdapter(cloud)
      .publishVersion(
        { id: "old-1", device: "old", clock: { old: 1 }, createdAt: now().toISOString(), format: 5, resolves: [] },
        snapshot,
      );
    const local = conflict.conflict!.branches.find((branch) => branch.local)!;
    expect((await two.sync.resolve(local.id)).phase).toBe("synced");
    expect((await pointerOf(two)).format).toBe(5);
  });
});

describe("переписывание своего указателя", () => {
  const pointerOf = async (dev: Device) => JSON.parse(cloud.store.get(`p_${await dev.sync.deviceId()}`)!);

  it("части пропали во время переписывания — указатель снят, следующий обмен публикует версию заново", async () => {
    const legacy = await loadBuild(FORMAT5_BUILD);
    const old = await device("old", { lessons: ["mech-1"], build: legacy });
    await study(old, [true, false]);
    await old.sync.exchange();
    const published = await pointerOf(old);
    const write = cloud.setItem.bind(cloud);
    let race = true;
    cloud.setItem = async (key, value) => {
      if (race && key === `p_${published.device}`) {
        race = false;
        cloud.store.delete(key);
        for (let index = 0; index < published.parts; index++) cloud.store.delete(`v_${published.id}_${index}`);
      }
      await write(key, value);
    };
    const updated = await device("old", { db: old.db });
    await updated.sync.exchange();
    expect(cloud.store.has(`p_${published.device}`)).toBe(false);
    expect((await updated.sync.exchange()).phase).toBe("synced");
    expect((await pointerOf(updated)).id).not.toBe(published.id);
    const other = await device("other", { lessons: ["mech-1"] });
    expect((await other.sync.exchange()).phase).toBe("synced");
    expect(await statesOf(other)).toEqual(await statesOf(updated));
  });
  it("указатель более новой сборки этого устройства не переписывается", async () => {
    const phone = await device("phone", { lessons: ["mech-1"] });
    await study(phone, [true]);
    await phone.sync.exchange();
    const raw = await pointerOf(phone);
    const newer = JSON.stringify({ ...raw, format: SNAPSHOT_FORMAT + 1, reads: [3, 4, 5, 6, 7] });
    cloud.store.set(`p_${raw.device}`, newer);
    await phone.sync.exchange();
    expect(cloud.store.get(`p_${raw.device}`)).toBe(newer);
  });
  it("без блокировки вкладок указатель не переписывается", async () => {
    const legacy = await loadBuild(FORMAT5_BUILD);
    const old = await device("old", { lessons: ["mech-1"], build: legacy });
    await study(old, [true]);
    await old.sync.exchange();
    const before = cloud.store.get(`p_${await old.sync.deviceId()}`);
    const updated = await device("old", { db: old.db, lock: async () => "unsupported" });
    await updated.sync.exchange();
    expect(cloud.store.get(`p_${await old.sync.deviceId()}`)).toBe(before);
  });
});

it("устаревшая сборка из кеша на том же устройстве: пишет 5 без reads, другие пишут 5, после обновления снова 6", async () => {
  const pointerOf = async (dev: Device) => JSON.parse(cloud.store.get(`p_${await dev.sync.deviceId()}`)!);
  const phases: string[] = [];
  const exchange = async (dev: Device) => phases.push((await dev.sync.exchange()).phase);
  const phone = await device("phone", { lessons: ["mech-1"] });
  const tablet = await device("tablet", { lessons: ["mech-1"] });
  await study(tablet, [true]);
  await exchange(tablet);
  await exchange(phone);
  await study(phone, [false, true]);
  await exchange(phone);
  expect((await pointerOf(phone)).format).toBe(6);
  const cached = await device("phone", { db: phone.db, build: await loadBuild(FORMAT5_BUILD) });
  await study(cached, [true]);
  await exchange(cached);
  expect(await pointerOf(phone)).toMatchObject({ format: 5 });
  expect((await pointerOf(phone)).reads).toBeUndefined();
  await exchange(tablet);
  await study(tablet, [false]);
  await exchange(tablet);
  expect((await pointerOf(tablet)).format).toBe(5);
  await exchange(phone);
  expect((await pointerOf(phone)).reads).toEqual([3, 4, 5, 6]);
  await study(tablet, [true]);
  await exchange(tablet);
  expect((await pointerOf(tablet)).format).toBe(6);
  await exchange(phone);
  expect(phases.every((phase) => phase === "synced")).toBe(true);
  expect(await statesOf(phone)).toEqual(await statesOf(tablet));
});

describe("облако новее приложения", () => {
  const withPointer = async (format: number) => {
    const phone = await device("phone", { lessons: ["mech-1"] });
    await study(phone, [true]);
    await phone.sync.exchange();
    const tablet = await device("tablet", { lessons: ["mech-1"] });
    await tablet.sync.exchange();
    const phoneDevice = await phone.sync.deviceId();
    const pointer = JSON.parse(cloud.store.get(`p_${phoneDevice}`)!);
    cloud.store.set(
      `p_${phoneDevice}`,
      JSON.stringify({ ...pointer, id: `${phoneDevice}-9`, format, clock: { [phoneDevice]: 9 } }),
    );
    const newer = vi.fn();
    tablet.sync.onNewerFormat = newer;
    return { tablet, newer };
  };

  it("формат новее своего — колбэк один раз за заход", async () => {
    const { tablet, newer } = await withPointer(SNAPSHOT_FORMAT + 1);
    expect((await tablet.sync.exchange()).error?.kind).toBe("format");
    expect(newer).toHaveBeenCalledTimes(1);
    await tablet.sync.exchange();
    expect(newer).toHaveBeenCalledTimes(2);
  });
  it.each([2, 3, 4, 5, 6])("формат %i — колбэка нет", async (format) => {
    const { tablet, newer } = await withPointer(format);
    await tablet.sync.exchange();
    expect(newer).not.toHaveBeenCalled();
  });
  it("другая ошибка — колбэка нет", async () => {
    const { tablet, newer } = await withPointer(SNAPSHOT_FORMAT);
    for (const key of [...cloud.store.keys()].filter((key) => key.startsWith("v_"))) cloud.store.delete(key);
    expect((await tablet.sync.exchange()).phase).toBe("error");
    expect(newer).not.toHaveBeenCalled();
  });
});

it("сборка отката читает 6, снимает 6 из reads своего указателя, и новые устройства пишут 5 без окна выбора", async () => {
  const pointerOf = async (dev: Device) => JSON.parse(cloud.store.get(`p_${await dev.sync.deviceId()}`)!);
  const phases: string[] = [];
  const exchange = async (dev: Device) => phases.push((await dev.sync.exchange()).phase);
  const phone = await device("phone", { lessons: ["mech-1"] });
  const tablet = await device("tablet", { lessons: ["mech-1"] });
  await study(phone, [true, false]);
  await exchange(phone);
  const six = await pointerOf(phone);
  expect(six.format).toBe(6);
  await exchange(tablet);
  const rollback = await device("phone", { db: phone.db, build: await loadBuild(ROLLBACK_BUILD) });
  await exchange(rollback);
  expect(await pointerOf(phone)).toEqual({ ...six, reads: [3, 4, 5] });
  const fresh = await device("fresh", { lessons: ["mech-1"] });
  await exchange(fresh);
  expect(await statesOf(fresh)).toEqual(await statesOf(phone));
  await study(tablet, [true]);
  await exchange(tablet);
  expect((await pointerOf(tablet)).format).toBe(5);
  await exchange(rollback);
  await study(rollback, [false]);
  await exchange(rollback);
  expect((await pointerOf(phone)).format).toBe(5);
  await exchange(tablet);
  await exchange(fresh);
  expect(phases.every((phase) => phase === "synced")).toBe(true);
  expect(await statesOf(tablet)).toEqual(await statesOf(phone));
  expect(await statesOf(fresh)).toEqual(await statesOf(phone));
});
