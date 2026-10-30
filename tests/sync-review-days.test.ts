import "fake-indexeddb/auto";
import { forgetAncestors } from "./helpers/sync";
import { beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { buildAndCommit, submitAnswer } from "./helpers/ops";
import { makeSession, studyDay } from "../src/domain/learning";
import { isReviewDay, mergeReviewDays, readReviewDays, reviewDaysOf } from "../src/domain/review-days";
import { decodeSnapshot, encodeSnapshot } from "../src/sync/codec";
import { kvAdapter } from "../src/sync/adapter";
import { SyncCoordinator } from "../src/sync/coordinator";
import { memoryTransport, type MemoryTransport } from "../src/sync/transport";
import { applySnapshot, META, readSnapshot, writeMeta } from "../src/sync/snapshot";
import type { CompactSnapshot } from "../src/sync/types";
import { courseProgress, languageProgress } from "../src/storage/progress";
import { courses } from "../src/storage/courses";
import { installCompleted } from "./helpers/content";
import { wordRef } from "./helpers/cards";

const TZ = "Asia/Nicosia";
let cloud: MemoryTransport;
let clockMs = Date.parse("2026-10-05T08:00:00Z");
const now = () => new Date(clockMs);
const tick = (minutes = 1) => {
  clockMs += minutes * 60000;
  return now();
};
const nextDay = () => tick(24 * 60);
let counter = 0;

beforeEach(() => {
  cloud = memoryTransport();
  clockMs = Date.parse("2026-10-05T08:00:00Z");
});

async function device(name: string) {
  const db = new AppDatabase(`tetradio-review-days-${name}-${++counter}`);
  await db.delete();
  await db.open();
  await installCompleted(db, ["mech-1"]);
  const sync = new SyncCoordinator({
    database: db,
    adapter: kvAdapter(cloud),
    now,
    label: name,
    schedule: () => () => undefined,
    retryBaseMs: 1,
  });
  return { db, sync };
}
type Device = Awaited<ReturnType<typeof device>>;

async function study(dev: Device, answers: boolean[], mode: "scheduled" | "practice" = "scheduled") {
  const session = await makeSession({ source: dexieSource(dev.db), now: tick(), random: () => 0.31, mode });
  await dev.db.sessions.add(session);
  for (const [index, item] of session.items
    .filter((item) => !item.eventId)
    .slice(0, answers.length)
    .entries())
    await submitAnswer({
      session,
      item,
      correct: answers[index],
      answer: "",
      responseTimeMs: 900,
      activeTimeMs: 900,
      timezone: TZ,
      now: tick(),
      database: dev.db,
    });
}
const localDays = async (dev: Device) => [...new Set((await dev.db.events.toArray()).map((e) => e.localDate))].sort();
const flat = (snapshot: Pick<CompactSnapshot, "reviewDays">) =>
  [...new Set(Object.values(snapshot.reviewDays ?? {}).flat())].sort();
/** База, записанная прежней версией: без поля дней, отсечка — сейчас. */
const asPreviousBuild = async (dev: Device) => {
  const base = (await dev.db.baseSummary.get("base"))!;
  const { reviewDays: _, ...rest } = base;
  await dev.db.baseSummary.put({ ...rest, asOf: now().toISOString() });
};
async function published() {
  const adapter = kvAdapter(cloud);
  const pointers = (await adapter.listPointers()).pointers;
  const latest = pointers.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
  return adapter.readVersion(latest);
}

describe("дни повторений: домен", () => {
  const ref = wordRef("w1");
  const event = (localDate: string, mode: "scheduled" | "practice" = "scheduled") => ({
    ref,
    unitKey: "w:w1",
    localDate,
    mode,
  });
  it("тренировка урока дня не даёт; дни по курсам, по порядку и без повторов", () => {
    expect(isReviewDay(event("2026-10-01", "practice"))).toBe(false);
    const owner = new Map([["w:w1", "greek-a2"]]);
    expect(
      reviewDaysOf(
        [event("2026-10-03"), event("2026-10-01"), event("2026-10-03"), event("2026-10-02", "practice")],
        owner,
      ),
    ).toEqual({ "greek-a2": ["2026-10-01", "2026-10-03"] });
    expect(reviewDaysOf([event("2026-10-03")], new Map())).toEqual({});
  });
  it("объединение и защитное чтение", () => {
    expect(mergeReviewDays({ a: ["2026-10-02"] }, { a: ["2026-10-01"], b: ["2026-10-05"] }, undefined)).toEqual({
      a: ["2026-10-01", "2026-10-02"],
      b: ["2026-10-05"],
    });
    expect(readReviewDays([])).toEqual({});
    expect(readReviewDays("x")).toEqual({});
    expect(readReviewDays({ a: ["2026-10-01", 5, "вчера"], b: "2026-10-01" })).toEqual({ a: ["2026-10-01"] });
  });
});

describe("дни повторений: кодек", () => {
  const base = async () => {
    const dev = await device("codec");
    await study(dev, [true]);
    return readSnapshot(dev.db, now());
  };
  it("круговое кодирование в форматах 5 и 6, пустые дни не пишутся", async () => {
    const snapshot = { ...(await base()), reviewDays: { "greek-a2": ["2026-09-30", "2026-10-01", "2026-10-31"] } };
    for (const format of [5, 6]) {
      const text = encodeSnapshot(snapshot, format);
      expect(JSON.parse(text).rd).toEqual([["greek-a2", [20726, 1, 30]]]);
      expect(decodeSnapshot(text).reviewDays).toEqual(snapshot.reviewDays);
    }
    expect(JSON.parse(encodeSnapshot({ ...snapshot, reviewDays: {} }))).not.toHaveProperty("rd");
  });
  it("день со сбитых часов не попадает в провод и не портит остальные дни", async () => {
    const snapshot = {
      ...(await base()),
      reviewDays: { a: ["1969-12-31", "2026-02-30", "2026-10-01"], b: ["2101-01-01"] },
    };
    expect(JSON.parse(encodeSnapshot(snapshot)).rd).toEqual([["a", [20727]]]);
    const wire = JSON.parse(encodeSnapshot(snapshot));
    const decoded = decodeSnapshot(JSON.stringify({ ...wire, rd: [["bad", [-1]], ...wire.rd, ["a", [20728]]] }));
    expect(decoded.reviewDays).toEqual({ a: ["2026-10-01", "2026-10-02"] });
  });
  it("испорченное поле — версия без дней, остальное применяется", async () => {
    const wire = JSON.parse(encodeSnapshot(await base()));
    for (const rd of ["x", [["a", [-1]]], [["a", [1.5]]], [["a", [20000, 0]]], [["a", [99999]]], [[1, [1]]], [["a"]]]) {
      const decoded = decodeSnapshot(JSON.stringify({ ...wire, rd }));
      expect(decoded.reviewDays).toBeUndefined();
      expect(decoded.states.length).toBeGreaterThan(0);
    }
  });
  it("кодек прежней версии читает версию с днями", async () => {
    const fixture = (await import("./fixtures/sync-review-days.json")).default;
    expect(fixture.rd).toBeDefined();
    const { decodeSnapshot: previous } = await import("./fixtures/codec-main");
    const { rd: _, ...withoutDays } = fixture;
    expect(previous(JSON.stringify(fixture))).toEqual(previous(JSON.stringify(withoutDays)));
  });
});

describe("дни повторений: снимок и применение", () => {
  it("первая публикация после обновления содержит дни всей истории", async () => {
    const phone = await device("phone");
    await study(phone, [true]);
    await buildAndCommit(phone.db, now(), "phone-1");
    nextDay();
    await study(phone, [true]);
    await asPreviousBuild(phone);
    nextDay();
    tick(60);
    expect(flat(await readSnapshot(phone.db, now()))).toEqual(await localDays(phone));
    expect((await localDays(phone)).length).toBe(2);
  });
  it("новое событие добавляет день; часы назад не теряют его", async () => {
    const phone = await device("phone");
    await study(phone, [true]);
    nextDay();
    await buildAndCommit(phone.db, now(), "phone-1");
    // Часы ушли назад на два часа: событие нового дня раньше отсечки базы.
    tick(-120);
    await study(phone, [false]);
    const snapshot = await buildAndCommit(phone.db, now(), "phone-2");
    expect(await localDays(phone)).toHaveLength(2);
    expect(flat(snapshot)).toEqual(await localDays(phone));
  });
  it("применение чужой версии до первой публикации сохраняет историю устройства", async () => {
    const phone = await device("phone");
    const laptop = await device("laptop");
    await study(phone, [true]);
    await buildAndCommit(phone.db, now(), "phone-1");
    await writeMeta(phone.db, META.dirty, null);
    await asPreviousBuild(phone);
    nextDay();
    tick(60);
    await study(laptop, [true]);
    const remote = await buildAndCommit(laptop.db, now(), "laptop-1");
    expect(await applySnapshot(phone.db, remote, "laptop-1", { laptop: 1 }, now(), { ifClean: true })).toBe(true);
    nextDay();
    const days = flat(await readSnapshot(phone.db, now()));
    expect(days).toEqual([...new Set([...(await localDays(phone)), ...(await localDays(laptop))])].sort());
    expect(days.length).toBe(2);
  });
  it("версия без дней и база без поля не стирают известных дней", async () => {
    const phone = await device("phone");
    const old = await device("old");
    await study(phone, [true]);
    await buildAndCommit(phone.db, now(), "phone-1");
    await asPreviousBuild(phone);
    nextDay();
    tick(60);
    const { reviewDays: _, ...withoutDays } = await buildAndCommit(old.db, now(), "old-1");
    await applySnapshot(phone.db, withoutDays, "old-1", { old: 1 }, now());
    expect(flat(await readSnapshot(phone.db, now()))).toEqual(await localDays(phone));
  });
});

describe("дни повторений: обмен и конфликт", () => {
  async function diverged() {
    const phone = await device("phone");
    const laptop = await device("laptop");
    await study(phone, [true]);
    await phone.sync.exchange();
    await laptop.sync.exchange();
    nextDay();
    await study(phone, [true]);
    await phone.sync.exchange();
    nextDay();
    await study(laptop, [false]);
    await forgetAncestors(laptop.db);
    const state = await laptop.sync.exchange();
    expect(state.phase).toBe("conflict");
    const all = [...new Set([...(await localDays(phone)), ...(await localDays(laptop))])].sort();
    expect(all.length).toBe(3);
    return { phone, laptop, state, all };
  }
  it("обмен переносит дни на другое устройство", async () => {
    const phone = await device("phone");
    const laptop = await device("laptop");
    await study(phone, [true]);
    nextDay();
    await study(phone, [true]);
    await phone.sync.exchange();
    await laptop.sync.exchange();
    expect(flat(await readSnapshot(laptop.db, now()))).toEqual(await localDays(phone));
  });
  it("выбор версии другого устройства публикует дни обеих ветвей", async () => {
    const { laptop, state, all } = await diverged();
    await laptop.sync.resolve(state.conflict!.branches.find((branch) => !branch.local)!.id);
    expect(flat(await published())).toEqual(all);
  });
  it("выбор «Это устройство» публикует дни обеих ветвей", async () => {
    const { laptop, state, all } = await diverged();
    await laptop.sync.resolve(state.conflict!.branches.find((branch) => branch.local)!.id);
    expect(flat(await published())).toEqual(all);
  });
  it("объединение публикует дни обеих ветвей", async () => {
    const phone = await device("phone");
    const laptop = await device("laptop");
    await study(phone, [true]);
    await phone.sync.exchange();
    await laptop.sync.exchange();
    nextDay();
    await study(phone, [true]);
    await phone.sync.exchange();
    nextDay();
    await study(laptop, [false]);
    const all = [...new Set([...(await localDays(phone)), ...(await localDays(laptop))])].sort();
    expect((await laptop.sync.exchange()).conflict).toBeNull();
    expect(flat(await published())).toEqual(all);
  });
});

describe("дни повторений на «Прогрессе»", () => {
  it("день из облака виден в сетке и в неделе своего курса, испорченное поле — без ошибки", async () => {
    const laptop = await device("laptop");
    const before = await courseProgress(now(), TZ, undefined, laptop.db);
    expect(before.days.reviews).toEqual([]);
    const course = (await laptop.db.courses.toArray())[0]?.id ?? (await laptop.db.catalog.toArray())[0]?.id;
    const today = studyDay(now(), TZ);
    await laptop.db.baseSummary.put({
      id: "base",
      asOf: now().toISOString(),
      versionId: "phone-1",
      stats: { days: [], recentByType: {}, answers: 0, answeredKeys: [] },
      reviewDays: { [course!]: ["2026-09-29", today], "other-course": ["2026-10-01"] },
    });
    const after = await courseProgress(now(), TZ, course, laptop.db);
    expect(after.days.reviews).toEqual(["2026-09-29", today]);
    expect(after.week.reviewDays).toEqual([today]);
    const language = (await courses(laptop.db)).find((entry) => entry.id === course)!.language;
    const total = (await languageProgress(now(), TZ, language, laptop.db)).total;
    expect(total.days.reviews).toEqual(["2026-09-29", today]);
    expect(total.week.reviewDays).toEqual([today]);
    await laptop.db.baseSummary.update("base", { reviewDays: "испорчено" as never });
    expect((await courseProgress(now(), TZ, course, laptop.db)).days.reviews).toEqual([]);
  });
});
