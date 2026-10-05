import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { applySnapshot, buildAndCommit, buildSnapshot, META, readMeta } from "../src/sync/snapshot";
import { decodeSnapshot, encodeRef, encodeSnapshot, SnapshotFormatError } from "../src/sync/codec";
import { kvAdapter, splitParts } from "../src/sync/adapter";
import { SyncCoordinator } from "../src/sync/coordinator";
import { CLOUD_LIMITS, memoryTransport, type MemoryTransport } from "../src/sync/transport";
import { SNAPSHOT_FORMAT, type CompactSnapshot } from "../src/sync/types";
import { dexieSource } from "../src/storage/queries";
import type { SkillSummary } from "../src/domain/skills";
import { makeSession } from "../src/domain/learning";
import { installLesson, refreshCatalog } from "../src/content/client";
import { submitAnswer } from "../src/storage/ops";
import { unitKey } from "./helpers/cards";
import { memoryFetcher } from "./helpers/content";
import { installMixed, MIXED_LESSON, mixedContent } from "./helpers/mixed";
import type { LearningRef } from "../src/domain/types";

let cloud: MemoryTransport;
let clockMs = Date.parse("2026-09-16T08:00:00Z");
const tick = (minutes = 1) => {
  clockMs += minutes * 60000;
  return new Date(clockMs);
};
const now = () => new Date(clockMs);
let counter = 0;
const W = (id: string): LearningRef => ({ kind: "word", id });
const P = (id: string): LearningRef => ({ kind: "phrase", id });

async function device(name: string, options: { mixed?: boolean; maxKeys?: number } = {}) {
  const db = new AppDatabase(`tetradio-sync-mixed-${name}-${++counter}`);
  await db.delete();
  await db.open();
  if (options.mixed) await installMixed(db);
  const sync = new SyncCoordinator({
    database: db,
    adapter: kvAdapter(cloud),
    now,
    label: name,
    schedule: () => () => undefined,
    retryBaseMs: 1,
  });
  return { db, sync, name };
}
type Device = Awaited<ReturnType<typeof device>>;
/** Ответы на конкретные карточки: состояние и навык получает именно та карточка, что названа. */
async function study(dev: Device, refs: LearningRef[], answers: boolean[]) {
  const session = await makeSession({ source: dexieSource(dev.db), now: tick(), random: () => 0.31, refs });
  await dev.db.sessions.add(session);
  for (const [index, item] of session.items.entries())
    await submitAnswer({
      session,
      item,
      correct: answers[index] ?? true,
      answer: "",
      responseTimeMs: 900,
      activeTimeMs: 900,
      timezone: "Asia/Nicosia",
      now: tick(),
      database: dev.db,
    });
  return session.items.map((item) => item.unitKey);
}
const statesOf = async (dev: Device) =>
  (await dev.db.cardStates.orderBy("unitKey").toArray()).map((state) => ({
    ...state,
    card: {
      ...state.card,
      due: new Date(state.card.due).toISOString(),
      last_review: state.card.last_review ? new Date(state.card.last_review).toISOString() : undefined,
    },
  }));

beforeEach(() => {
  cloud = memoryTransport();
  clockMs = Date.parse("2026-09-16T08:00:00Z");
});

describe("компактный снимок", () => {
  it("кодек обратим, числа FSRS не меняются, а тексты и ответы в снимок не попадают", async () => {
    const phone = await device("phone", { mixed: true });
    await study(phone, [W("w070"), P("p-grafo"), P("p-xora"), P("p-paidi")], [true, false, true, true]);
    const snapshot = await buildAndCommit(phone.db, now(), "dev-1");
    expect(snapshot.format).toBe(SNAPSHOT_FORMAT);
    const text = encodeSnapshot(snapshot);
    expect(decodeSnapshot(text)).toEqual(snapshot); // обратимость
    const decoded = decodeSnapshot(text);
    expect(decoded.states.map((state) => state.ref)).toEqual(snapshot.states.map((state) => state.ref));
    expect(
      decoded.states.every(
        (state, index) =>
          state.card.stability === snapshot.states[index].card.stability &&
          state.card.due === snapshot.states[index].card.due,
      ),
    ).toBe(true);
    expect(decoded.stats).toEqual(snapshot.stats);
    // Виды карточек входят в идентичность прогресса.
    expect(new Set(snapshot.states.map((state) => state.ref.kind))).toEqual(new Set(["word", "phrase"]));
    expect(snapshot.skills.map((entry) => entry.ref.kind)).toContain("phrase");
    // Ни текстов карточек, ни ответов.
    for (const secret of ["Γράφω ένα γράμμα", "Я пишу письмо"]) expect(text, secret).not.toContain(secret);
    expect(text).toContain(encodeRef(P("p-grafo"))); // ссылка на карточку — вид и идентификатор
  });
  it("формат 4 на проводе: урок — завершением, без расписания и дат; снятые настройки и курсы — пустыми полями для прежних версий", async () => {
    const phone = await device("format4", { mixed: true });
    const lessonId = (await phone.db.lessons.toArray())[0].id;
    await phone.db.lessons.update(lessonId, { completed: true, updatedAt: "2026-09-16T07:00:00.000Z" });
    const snapshot = await buildAndCommit(phone.db, now(), "dev-1");
    const wire = JSON.parse(encodeSnapshot(snapshot));
    expect(wire.f).toBe(4);
    expect(wire.s).toEqual({});
    expect(wire.cs).toEqual([]);
    expect(wire.l).toContainEqual([lessonId, 1, Date.parse("2026-09-16T07:00:00.000Z")]);
    const decoded = decodeSnapshot(JSON.stringify(wire));
    expect(decoded).toEqual(snapshot);
    expect(decoded.lessons.find((lesson) => lesson.id === lessonId)).toEqual({
      id: lessonId,
      completed: true,
      updatedAt: "2026-09-16T07:00:00.000Z",
    });
  });
  it("снимок формата 3 читается: статус становится завершением, расписание и даты отбрасываются", async () => {
    const phone = await device("format3", { mixed: true });
    const lessonId = (await phone.db.lessons.toArray())[0].id;
    await phone.db.lessons.update(lessonId, { completed: true, updatedAt: "2026-09-16T07:00:00.000Z" });
    await study(phone, [W("w070"), P("p-grafo")], [true, false]);
    const snapshot = await buildAndCommit(phone.db, now(), "dev-1");
    const wire = JSON.parse(encodeSnapshot(snapshot));
    const format3 = {
      ...wire,
      f: 3,
      cs: wire.cs.map(([id]: [string, number]) => ({
        id,
        subscribed: true,
        newItemsPerDay: 5,
        schedule: { startDate: "2026-09-14", weekdays: [1, 4], lessonHour: 9 },
      })),
      l: wire.l.map(([id, completed, at]: [string, 0 | 1, number]) => [
        id,
        "2026-10-01",
        completed ? "completed" : "upcoming",
        at,
      ]),
    };
    const decoded = decodeSnapshot(JSON.stringify(format3));
    expect(decoded).toEqual(snapshot); // дневной предел и расписание курса прежних версий отбрасываются
    expect(Object.keys(decoded.lessons[0]).sort()).toEqual(["completed", "id", "updatedAt"]);

    const tablet = await device("format3-reader", { mixed: true });
    expect(await applySnapshot(tablet.db, decoded, "f3-1", { other: 1 }, now())).toBe(true);
    expect(await tablet.db.lessons.get(lessonId)).toEqual({
      ...(await phone.db.lessons.get(lessonId)),
      completed: true,
      updatedAt: "2026-09-16T07:00:00.000Z",
    });
    expect(await statesOf(tablet)).toEqual(await statesOf(phone));
  });
  it("ссылка снятого вида из чужого снимка отбрасывается, а слова и фразы применяются", async () => {
    const phone = await device("phone", { mixed: true });
    await study(phone, [W("w070"), P("p-grafo")], [true, true]);
    const snapshot = await buildAndCommit(phone.db, now(), "dev-1");
    const wire = JSON.parse(encodeSnapshot(snapshot));
    // Снимок старого клиента: те же записи плюс прогресс карточки снятого вида под своим кодом `c`.
    const dropped = "cc-grafo";
    wire.st = [...wire.st, [dropped, ...wire.st[0].slice(1)]];
    wire.sk = [...wire.sk, [dropped, ...wire.sk[0].slice(1)]];
    wire.x.w = [...wire.x.w, dropped];
    wire.x.d = wire.x.d.map(([date, answers, keys]: [string, number, string[]]) => [date, answers, [...keys, dropped]]);
    const decoded = decodeSnapshot(JSON.stringify(wire));
    expect(decoded.states).toEqual(snapshot.states);
    expect(decoded.skills).toEqual(snapshot.skills);
    expect(decoded.stats).toEqual(snapshot.stats);
    expect(encodeSnapshot(decoded)).not.toContain(dropped); // свой снимок ссылку снятого вида не публикует
    expect(await applySnapshot(phone.db, decoded, "mixed-1", { other: 1 }, now())).toBe(true);
    expect((await phone.db.cardStates.toArray()).map((state) => state.ref.kind)).not.toContain("cloze");
  });
  it("ключ снятого вида в своей сводке не срывает публикацию снимка", async () => {
    const phone = await device("phone", { mixed: true });
    await study(phone, [W("w070"), P("p-grafo")], [true, true]);
    const snapshot = await buildAndCommit(phone.db, now(), "dev-1");
    // История ответов снятый вид сохранила, поэтому его ключ остаётся в сводке дня и в списке отвеченных.
    const dropped = JSON.stringify(["cloze", "c-grafo"]);
    const local: CompactSnapshot = {
      ...snapshot,
      stats: {
        ...snapshot.stats,
        answeredKeys: [...snapshot.stats.answeredKeys, dropped],
        days: snapshot.stats.days.map((day) => ({ ...day, keys: [...day.keys, dropped] })),
      },
    };
    const text = encodeSnapshot(local);
    expect(text).not.toContain("cloze");
    expect(decodeSnapshot(text).stats).toEqual(snapshot.stats);
  });
  it("смешанный снимок укладывается в лимиты Telegram и не публикуется частично при их превышении", async () => {
    const phone = await device("phone", { mixed: true });
    await study(phone, [P("p-grafo"), P("p-xora")], [true, true]);
    const snapshot = await buildSnapshot(phone.db, now());
    const parts = splitParts(encodeSnapshot(snapshot));
    expect(parts.length * 3 + 2).toBeLessThan(CLOUD_LIMITS.maxKeys);
    cloud = memoryTransport({ limits: { maxKeys: 1 } });
    const tight = new SyncCoordinator({
      database: phone.db,
      adapter: kvAdapter(cloud),
      now,
      schedule: () => () => undefined,
      retryBaseMs: 1,
    });
    const before = await statesOf(phone);
    const status = await tight.exchange();
    expect(status.phase).toBe("error");
    expect(status.error?.kind).toBe("limit");
    expect(cloud.store.size).toBe(0); // частичной версии нет
    expect(await statesOf(phone)).toEqual(before); // локальные ответы сохранены
    expect(await readMeta(phone.db, META.dirty)).toBeTruthy();
  });
  it("форматы 1 и 2 и неизвестный формат не читаются", () => {
    const body = { st: [], sk: [], s: {}, x: { d: [], r: {}, n: 0, w: [] }, cs: [], l: [], p: [], b: [] };
    for (const f of [1, 2, SNAPSHOT_FORMAT + 1])
      expect(() => decodeSnapshot(JSON.stringify({ f, ...body })), `формат ${f}`).toThrow(SnapshotFormatError);
    expect(decodeSnapshot(JSON.stringify({ f: 3, ...body })).format).toBe(SNAPSHOT_FORMAT);
  });
});

describe("обмен смешанным прогрессом между устройствами", () => {
  it("второе устройство получает сроки и навыки фраз, прогресс слова не подменяется", async () => {
    const phone = await device("phone", { mixed: true });
    const tablet = await device("tablet", { mixed: true });
    await study(phone, [W("w070"), P("p-grafo"), P("p-xora"), P("p-paidi")], [true, false, true, false]);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    expect(await statesOf(tablet)).toEqual(await statesOf(phone));
    const kinds = (await tablet.db.cardStates.toArray()).map((state) => state.ref.kind);
    expect(new Set(kinds)).toEqual(new Set(["word", "phrase"]));
    // Навыки совпадают покарточно, а связанное слово не получает прогресс фразы.
    const source = dexieSource(tablet.db);
    const cards = await source.cardsOf([P("p-grafo"), W("w070")]);
    const phraseSkills = await source.skillsOf(cards.get(unitKey(P("p-grafo")))!);
    const wordSkills = await source.skillsOf(cards.get(unitKey(W("w070")))!);
    // Исходы лежат каждый у своей карточки: слово отвечено верно, фраза — неверно.
    const outcomes = (summary: SkillSummary) => Object.values(summary.types).flatMap((skill) => skill?.recent ?? []);
    expect(outcomes(phraseSkills)).toEqual([false]);
    expect(outcomes(wordSkills)).toEqual([true]);
    expect((await tablet.db.cardStates.get(unitKey(W("w070"))))!.card.due).not.toEqual(
      (await tablet.db.cardStates.get(unitKey(P("p-grafo"))))!.card.due,
    );
    // Повторный обмен без изменений ничего не публикует.
    const keys = cloud.store.size;
    await phone.sync.exchange();
    await tablet.sync.exchange();
    expect(cloud.store.size).toBe(keys);
  });
  it("прогресс карточек неустановленного пакета ждёт установки, не участвует в обучении и принимается после неё", async () => {
    const phone = await device("phone", { mixed: true });
    const fresh = await device("fresh");
    await study(phone, [P("p-grafo"), P("p-xora")], [true, true]);
    await phone.sync.exchange();
    const missing: string[][] = [];
    fresh.sync.onMissingPackages = (ids) => {
      missing.push(ids);
    };
    expect((await fresh.sync.exchange()).phase).toBe("synced");
    expect(await fresh.db.cardStates.count()).toBe(0);
    expect(await fresh.db.cardStash.count()).toBe(2);
    expect((await fresh.db.cardStash.toArray()).map((row) => row.ref.kind).sort()).toEqual(["phrase", "phrase"]);
    expect(missing[0]).toContain(MIXED_LESSON);
    expect(await dexieSource(fresh.db).dueStates(now())).toHaveLength(0); // отложенное не попадает в очередь
    // Пакет установлен — отложенный прогресс становится обычным состоянием с теми же сроками.
    const fetcher = memoryFetcher(mixedContent());
    await refreshCatalog(fresh.db, fetcher);
    await installLesson(MIXED_LESSON, fresh.db, fetcher);
    expect(await fresh.db.cardStash.count()).toBe(0);
    expect(await statesOf(fresh)).toEqual(await statesOf(phone));
  });
  it.each([2, SNAPSHOT_FORMAT + 1])(
    "версия формата %i не применяется и не перезаписывается своим снимком",
    async (format) => {
      // Тем же отказом приложение формата 3 встречает версию формата 4: «обновите приложение», данные на месте.
      const phone = await device("phone", { mixed: true });
      const tablet = await device("tablet", { mixed: true });
      await study(phone, [P("p-grafo")], [true]);
      await phone.sync.exchange();
      await tablet.sync.exchange();
      const device1 = await phone.sync.deviceId();
      const pointer = JSON.parse(cloud.store.get(`p_${device1}`)!);
      cloud.store.set(
        `p_${device1}`,
        JSON.stringify({ ...pointer, id: `${device1}-9`, format, clock: { [device1]: 9 } }),
      );
      await study(tablet, [P("p-xora")], [false]);
      const before = await statesOf(tablet);
      const status = await tablet.sync.exchange();
      expect(status.phase).toBe("error");
      expect(status.error?.kind).toBe("format");
      expect(status.error?.message).toMatch(/Обновите приложение/);
      expect(await statesOf(tablet)).toEqual(before);
      expect(cloud.store.has(`p_${await tablet.sync.deviceId()}`)).toBe(false);
      expect(await readMeta(tablet.db, META.dirty)).toBeTruthy();
    },
  );
});
