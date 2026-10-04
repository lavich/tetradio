import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyCard, Rating, State } from "ts-fsrs";
import { indexWord, AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { wordRef } from "./helpers/cards";
import { ConflictError, markIntroduced, saveNewItemsPerDay, submitAnswer } from "../src/storage/ops";
import { makePlan, makeSession } from "../src/domain/learning";
import { type Word } from "../src/domain/types";
import { completeLessons, installLessons, wordsOf } from "./helpers/content";
import { installMixed, mixedPackage } from "./helpers/mixed";
import { unitKey } from "./helpers/cards";
import { applyPackage } from "../src/content/client";
import { checkTextAnswer } from "../src/domain/text-answer";
import { tiles } from "../src/domain/syllables";
import { phraseRevisionOf } from "../content/build";

const now = new Date("2026-09-15T09:00:00Z");
let db: AppDatabase;
beforeEach(async () => {
  await new AppDatabase("tetradio-test").delete();
  db = new AppDatabase("tetradio-test");
  await db.open();
});
const ALL = ["mech-1", "mech-2", "mech-3", "mech-4"];
/** Слова установленных уроков: каталог шире, чем набор, который тесты разворачивают в базе. */
const seedWords = [...new Map(ALL.flatMap((id) => wordsOf(id)).map((word) => [word.id, word])).values()];
/** Замена старого seed: все четыре урока установлены из пакетов в памяти и пройдены. */
const ensureSeed = async (database = db) => {
  await installLessons(database, ALL);
  await completeLessons(database, ALL);
};
const source = () => dexieSource(db);

describe("запись ответа", () => {
  const prepare = async () => {
    await ensureSeed(db);
    const session = await makeSession({ source: source(), now, random: () => 0.42 });
    await db.sessions.add(session);
    return { session };
  };
  const answer = (session: Awaited<ReturnType<typeof makeSession>>, item = session.items[0], extra = {}) =>
    submitAnswer({
      session,
      item,
      correct: true,
      answer: "",
      responseTimeMs: 1200,
      activeTimeMs: 5000,
      timezone: "Asia/Nicosia",
      now,
      database: db,
      ...extra,
    });
  /** Зрелая карточка в Review: на ней видно, сбрасывает «Почти» интервал или нет. */
  const asMature = async (item: Awaited<ReturnType<typeof makeSession>>["items"][number]) => {
    await db.cardStates.put({
      unitKey: item.unitKey,
      ref: item.ref,
      introducedAt: "2026-08-01T09:00:00Z",
      version: 1,
      card: {
        ...createEmptyCard(new Date("2026-08-01")),
        due: now,
        state: State.Review,
        stability: 30,
        difficulty: 5,
        scheduled_days: 30,
        elapsed_days: 30,
        reps: 5,
        last_review: new Date("2026-08-16T09:00:00Z"),
      },
    });
    return { ...item, isNew: false, expectedVersion: 1 };
  };
  it("«Почти» получает Hard, оставляет карточку в повторении и добавляет тренировку", async () => {
    const { session } = await prepare();
    const item = await asMature(session.items[0]);
    const event = await answer(
      session,
      { ...item, type: "spelling" },
      { correct: false, status: "almost", answer: "σπιτι" },
    );
    expect(event.rating).toBe(Rating.Hard);
    expect(event.correct).toBe(false); // для сводки навыков «Почти» остаётся ошибкой
    const after = await db.cardStates.get(item.unitKey);
    expect(after!.card.state).toBe(State.Review);
    expect(after!.card.scheduled_days).toBeGreaterThan(1);
    const stored = (await db.sessions.get(session.id))!;
    expect(stored.items.some((entry) => entry.retryOf === item.id)).toBe(true);
  });
  it("быстрый верный выбор получает Easy, неспешный — Good", async () => {
    const { session } = await prepare();
    const fast = await answer(session, { ...session.items[0], type: "recognition" }, { responseTimeMs: 1200 });
    const slow = await answer(session, { ...session.items[1], type: "recognition" }, { responseTimeMs: 9000 });
    expect(fast.rating).toBe(Rating.Easy);
    expect(slow.rating).toBe(Rating.Good);
  });
  it("быстрое написание остаётся Good", async () => {
    const { session } = await prepare();
    const event = await answer(session, { ...session.items[0], type: "spelling" }, { responseTimeMs: 900 });
    expect(event.rating).toBe(Rating.Good);
  });
  it("провал дополнительной попытки расписание не двигает", async () => {
    const { session } = await prepare();
    const item = session.items[0];
    await answer(session, item, { correct: false });
    const afterFirst = await db.cardStates.get(item.unitKey);
    const stored = (await db.sessions.get(session.id))!;
    const retry = stored.items.find((entry) => entry.retryOf === item.id)!;
    expect(retry.mode).toBe("practice");
    await answer(stored, retry, { correct: false });
    const afterRetry = await db.cardStates.get(item.unitKey);
    expect(afterRetry!.version).toBe(afterFirst!.version);
    expect(afterRetry!.card.due).toEqual(afterFirst!.card.due);
  });
  it("двойное нажатие создаёт один ответ и один пересчёт FSRS", async () => {
    const { session } = await prepare();
    await Promise.all([answer(session), answer(session)]);
    expect(await db.events.count()).toBe(1);
    expect((await db.cardStates.get(session.items[0].unitKey))!.version).toBe(1);
    expect((await db.sessions.get(session.id))!.index).toBe(1);
  });
  it("отклоняет ответ из другой вкладки и не теряет уже записанные данные", async () => {
    const { session } = await prepare();
    await answer(session);
    const stale = { ...session.items[0], id: `${session.items[0].id}-copy` };
    await expect(answer(session, stale)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.events.count()).toBe(1);
  });
  it("знакомство сохраняется без ответа и изменения расписания", async () => {
    const { session } = await prepare();
    await markIntroduced(session.id, session.items[0].unitKey, 3000, db);
    await markIntroduced(session.id, session.items[0].unitKey, 4000, db);
    expect(await db.events.count()).toBe(0);
    expect(await db.cardStates.count()).toBe(0);
    expect((await db.sessions.get(session.id))!.introducedKeys).toEqual([session.items[0].unitKey]);
    expect((await db.sessions.get(session.id))!.activeTimeMs).toBe(4000);
  });
  it("ошибка атомарно добавляет одну тренировку после двух заданий", async () => {
    const { session } = await prepare();
    const event = await answer(session, session.items[0], { correct: false });
    expect(event.rating).toBe(Rating.Again);
    await answer(session, session.items[0], { correct: false });
    const stored = (await db.sessions.get(session.id))!;
    expect(stored.items).toHaveLength(session.items.length + 1);
    expect(stored.items[3]).toMatchObject({
      retryOf: session.items[0].id,
      mode: "practice",
      isNew: false,
      expectedVersion: 1,
    });
    const before = await db.cardStates.get(session.items[0].unitKey);
    await answer(stored, stored.items[3], { correct: false });
    expect(await db.cardStates.get(session.items[0].unitKey)).toEqual(before);
    expect((await db.sessions.get(session.id))!.items).toHaveLength(stored.items.length);
    expect(await db.events.count()).toBe(2);
  });
  it("ошибка в написании даёт в попытке сборку, а не повторный набор", async () => {
    const { session } = await prepare();
    const item = { ...session.items[0], type: "spelling" as const, options: [] };
    const stored = { ...session, items: [item, ...session.items.slice(1)] };
    await db.sessions.put(stored);
    const parts = tiles(item.card.kind === "word" ? item.card.word.greek : "");
    expect(parts.length).toBeGreaterThan(1); // слово занятия делится на слоги
    await answer(stored, item, { correct: false });
    const retry = (await db.sessions.get(session.id))!.items.find((entry) => entry.retryOf === item.id)!;
    expect(retry).toMatchObject({ type: "assembly", mode: "practice", isNew: false });
    expect([...retry.options].sort()).toEqual([...parts].sort());
  });
  it("ошибка в узнавании оставляет в попытке то же задание", async () => {
    const { session } = await prepare();
    const item = session.items.find((entry) => entry.type === "recognition")!;
    await answer(session, item, { correct: false });
    const retry = (await db.sessions.get(session.id))!.items.find((entry) => entry.retryOf === item.id)!;
    expect(retry.type).toBe("recognition");
    expect(retry.options).toEqual(item.options);
  });
  it("последняя ошибка не завершает занятие до дополнительной попытки", async () => {
    await prepare();
    const session = await makeSession({ source: source(), now, refs: [wordRef(seedWords[0].id)], random: () => 0.7 });
    await db.sessions.add(session);
    await answer(session, session.items[0], { correct: false });
    const stored = (await db.sessions.get(session.id))!;
    expect(stored.status).toBe("active");
    expect(stored.items).toHaveLength(2);
    const state = await db.cardStates.get(session.items[0].unitKey);
    const event = await answer(stored, stored.items[1]);
    expect(event.rating).toBe(Rating.Easy); // быстрое верное узнавание; на расписание это всё равно не влияет
    expect((await db.sessions.get(session.id))!.status).toBe("done");
    expect(await db.cardStates.get(session.items[0].unitKey)).toEqual(state);
  });
  it("ошибка транзакции откатывает событие, состояние и дополнительную попытку", async () => {
    const { session } = await prepare();
    const fail = () => {
      throw new Error("storage failed");
    };
    db.sessions.hook("updating", fail);
    await expect(answer(session, session.items[0], { correct: false })).rejects.toThrow("storage failed");
    db.sessions.hook("updating").unsubscribe(fail);
    expect(await db.events.count()).toBe(0);
    expect(await db.cardStates.count()).toBe(0);
    expect(await db.sessions.get(session.id)).toEqual(session);
    await answer(session, session.items[0], { correct: false });
    expect(await db.events.count()).toBe(1);
  });
  it("practice не сдвигает интервалы, но сохраняет результат навыка", async () => {
    await prepare();
    const practice = await makeSession({
      source: source(),
      now,
      random: () => 0.3,
      mode: "practice",
      refs: [wordRef(seedWords[0].id)],
    });
    await db.sessions.add(practice);
    await answer(practice, practice.items[0]);
    expect(await db.cardStates.count()).toBe(0);
    expect((await db.events.toArray())[0].mode).toBe("practice");
  });
});

describe("план курса на базе", () => {
  it("установленный, но не пройденный урок новых карточек не даёт", async () => {
    await installLessons(db, ALL);
    expect((await makePlan(source(), now)).newRefs).toEqual([]);
    await completeLessons(db, ["mech-1"]);
    const plan = await makePlan(source(), now);
    const own = new Set(
      (await db.lessonItems.where("lessonId").equals("mech-1").toArray()).map((item) => item.unitKey),
    );
    expect(plan.newRefs.length).toBeGreaterThan(0);
    expect(plan.newRefs.every((ref) => own.has(unitKey(ref)))).toBe(true);
  });
  it("предел новых — из записи курса, сохранение меняет только его", async () => {
    await ensureSeed(db);
    await saveNewItemsPerDay("mechanics", 3, db);
    expect((await makePlan(source(), now)).newRefs).toHaveLength(3);
    expect(await db.courses.get("mechanics")).toMatchObject({ newItemsPerDay: 3 });
  });
});

/** Смешанный урок: слова и фразы в одной базе; каждая карточка — своя единица повторения. */
describe("запись ответа на смешанном уроке", () => {
  const K = (kind: "word" | "phrase", id: string) => unitKey({ kind, id });
  const prepare = async (
    refs = [
      { kind: "phrase" as const, id: "p-xora" },
      { kind: "word" as const, id: "w070" },
      { kind: "phrase" as const, id: "p-grafo" },
      { kind: "phrase" as const, id: "p-paidi" },
      { kind: "phrase" as const, id: "p-lemeso" },
      { kind: "phrase" as const, id: "p-oikogeneia" },
    ],
  ) => {
    await installMixed(db);
    const session = await makeSession({ source: source(), now, random: () => 0.42, refs });
    await db.sessions.add(session);
    const item = (id: string) => session.items.find((entry) => entry.ref.id === id)!;
    return { session, item };
  };
  const answer = (
    session: Awaited<ReturnType<typeof makeSession>>,
    item: Awaited<ReturnType<typeof makeSession>>["items"][number],
    extra = {},
  ) =>
    submitAnswer({
      session,
      item,
      correct: true,
      answer: "",
      responseTimeMs: 1200,
      activeTimeMs: 5000,
      timezone: "Asia/Nicosia",
      now,
      database: db,
      ...extra,
    });
  it("ошибка во фразе добавляет ровно одну дополнительную попытку в режиме тренировки", async () => {
    const { session, item } = await prepare();
    const target = item("p-xora");
    await answer(session, target, { correct: false, answer: "διαβάζω" });
    const retries = (await db.sessions.get(session.id))!.items.filter((entry) => entry.retryOf === target.id);
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ mode: "practice", isNew: false, ref: target.ref });
  });
  it("слово и фразы независимы; ошибка во фразе не трогает слово и соседние фразы", async () => {
    const { session, item } = await prepare();
    expect(item("p-xora").card.kind).toBe("phrase");
    await answer(session, item("w070"));
    const word = await db.cardStates.get(K("word", "w070"));
    expect(word!.version).toBe(1);
    const event = await answer(session, item("p-xora"), { correct: false, answer: "κάτι" });
    expect(event.rating).toBe(Rating.Again);
    expect(event).toMatchObject({
      ref: { kind: "phrase", id: "p-xora" },
      unitKey: K("phrase", "p-xora"),
      snapshot: { text: "Η Κύπρος είναι μια μικρή χώρα.", translation: "Кипр — маленькая страна." },
    });
    expect(await db.cardStates.get(K("word", "w070"))).toEqual(word); // слово не изменилось
    expect(await db.cardStates.get(K("phrase", "p-grafo"))).toBeUndefined();
    const good = await answer(session, item("p-grafo"), { responseTimeMs: 9000 }); // неспешный верный ответ — Good
    expect(good.rating).toBe(Rating.Good);
    expect(good.snapshot).toEqual({ text: "Γράφω ένα γράμμα.", translation: "Я пишу письмо." });
    // Again и Good дают разные интервалы; у каждой фразы своё состояние.
    const again = (await db.cardStates.get(K("phrase", "p-xora")))!,
      goodState = (await db.cardStates.get(K("phrase", "p-grafo")))!;
    expect(new Date(goodState.card.due).getTime()).toBeGreaterThan(new Date(again.card.due).getTime());
    expect(again.version).toBe(1);
    expect(goodState.version).toBe(1);
  });
  it("две фразы одного урока сохраняют независимые состояния", async () => {
    const { session, item } = await prepare();
    await answer(session, item("p-paidi"));
    expect(await db.cardStates.get(K("phrase", "p-paidi"))).toBeTruthy();
    expect(await db.cardStates.get(K("phrase", "p-lemeso"))).toBeUndefined();
    const first = (await db.cardStates.get(K("phrase", "p-paidi")))!;
    await answer(session, item("p-lemeso"), { correct: false });
    expect(await db.cardStates.get(K("phrase", "p-paidi"))).toEqual(first); // ответ на вторую карточку не тронул первую
    const second = (await db.cardStates.get(K("phrase", "p-lemeso")))!;
    expect(second.unitKey).not.toBe(first.unitKey);
    expect(new Date(second.card.due).getTime()).toBeLessThan(new Date(first.card.due).getTime());
  });
  it("двойное нажатие и вторая вкладка: одно событие, не более одной дополнительной попытки, конфликт версии", async () => {
    const { session, item } = await prepare();
    const target = item("p-xora");
    await Promise.all([answer(session, target, { correct: false }), answer(session, target, { correct: false })]);
    expect(await db.events.count()).toBe(1);
    const stored = (await db.sessions.get(session.id))!;
    expect(stored.items.filter((entry) => entry.retryOf === target.id)).toHaveLength(1);
    expect(stored.items).toHaveLength(session.items.length + 1);
    const stale = { ...target, id: `${target.id}-copy` };
    await expect(answer(session, stale)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.events.count()).toBe(1);
    expect((await db.cardStates.get(K("phrase", "p-xora")))!.version).toBe(1);
  });
  it("дополнительная и ручная тренировки сохраняют результат без сдвига расписания", async () => {
    const { session, item } = await prepare();
    await answer(session, item("p-xora"), { correct: false });
    const before = await db.cardStates.get(K("phrase", "p-xora"));
    const stored = (await db.sessions.get(session.id))!;
    const retry = stored.items.find((entry) => entry.retryOf === item("p-xora").id)!;
    expect(retry).toMatchObject({ mode: "practice", isNew: false, expectedVersion: 1 });
    await answer(stored, retry, { correct: false });
    expect(await db.cardStates.get(K("phrase", "p-xora"))).toEqual(before);
    expect((await db.sessions.get(session.id))!.items).toHaveLength(stored.items.length); // второй попытки нет
    const practice = await makeSession({
      source: source(),
      now,
      random: () => 0.3,
      mode: "practice",
      refs: [{ kind: "phrase", id: "p-grafo" }],
    });
    await db.sessions.add(practice);
    await answer(practice, practice.items[0]);
    expect(await db.cardStates.get(K("phrase", "p-grafo"))).toBeUndefined();
    expect((await db.events.toArray()).filter((event) => event.ref.kind === "phrase")[0].mode).toBe("practice");
  });
  it("ошибка записи откатывает событие, состояние и попытку; упражнение остаётся доступным", async () => {
    const { session, item } = await prepare();
    const fail = () => {
      throw new Error("storage failed");
    };
    db.sessions.hook("updating", fail);
    await expect(answer(session, item("p-xora"), { correct: false })).rejects.toThrow("storage failed");
    db.sessions.hook("updating").unsubscribe(fail);
    expect(await db.events.count()).toBe(0);
    expect(await db.cardStates.count()).toBe(0);
    expect(await db.sessions.get(session.id)).toEqual(session);
    await answer(session, item("p-xora"), { correct: false });
    expect(await db.events.count()).toBe(1);
  });
  it("исправление пакета во время занятия: сессия проверяет снимок, новая сессия — обновлённый пакет", async () => {
    const { session, item } = await prepare([
      { kind: "phrase", id: "p-xora" },
      { kind: "phrase", id: "p-paidi" },
    ]);
    const pack = mixedPackage();
    const bump = (phrase: (typeof pack.phrases)[number], patch: Partial<(typeof pack.phrases)[number]>) => {
      const { revision: _r, ...rest } = phrase;
      const next = { ...rest, ...patch };
      return { ...next, revision: phraseRevisionOf(next) };
    };
    const next = {
      ...pack,
      version: `${pack.version}-fix`,
      phrases: pack.phrases.map((p) =>
        p.id === "p-xora" ? bump(p, { text: "Η Κύπρος είναι μια πολύ μικρή χώρα.", note: "Исправлено" }) : p,
      ),
    };
    await applyPackage(next, db);
    // Активная сессия хранит прежний текст: проверка идёт по снимку задания.
    const live = (await db.sessions.get(session.id))!;
    const xora = live.items.find((entry) => entry.ref.id === "p-xora")!;
    expect(xora.card.kind === "phrase" && xora.card.phrase.text).toBe("Η Κύπρος είναι μια μικρή χώρα.");
    expect(checkTextAnswer("η κυπρος ειναι μια μικρη χωρα.", ["Η Κύπρος είναι μια μικρή χώρα."]).status).toBe("almost");
    const event = await answer(live, xora, { correct: false, answer: "Η Κύπρος είναι μια πολύ μικρή χώρα." });
    expect(event.snapshot).toEqual({ text: "Η Κύπρος είναι μια μικρή χώρα.", translation: "Кипр — маленькая страна." });
    // Новая сессия читает исправленный пакет: текст новый, состояние и история прежние.
    const fresh = await makeSession({
      source: source(),
      now: new Date("2026-09-15T10:00:00Z"),
      random: () => 0.1,
      mode: "practice",
      refs: [
        { kind: "phrase", id: "p-xora" },
        { kind: "phrase", id: "p-paidi" },
      ],
    });
    const updated = fresh.items.find((entry) => entry.ref.id === "p-xora")!.card as { phrase: { text: string } };
    expect(updated.phrase.text).toBe("Η Κύπρος είναι μια πολύ μικρή χώρα.");
    expect(fresh.items.find((entry) => entry.ref.id === "p-xora")!.expectedVersion).toBe(1);
    expect(await db.events.count()).toBe(1);
    expect(item("p-xora").expectedVersion).toBe(0);
  });
  it("знакомство сохраняется по ключу карточки любого вида без события и без сдвига интервала", async () => {
    const { session, item } = await prepare();
    await markIntroduced(session.id, K("phrase", "p-xora"), 3000, db);
    await markIntroduced(session.id, K("phrase", "p-grafo"), 4000, db);
    await markIntroduced(session.id, K("phrase", "p-xora"), 5000, db);
    expect((await db.sessions.get(session.id))!.introducedKeys).toEqual([
      K("phrase", "p-xora"),
      K("phrase", "p-grafo"),
    ]);
    expect(await db.events.count()).toBe(0);
    expect(await db.cardStates.count()).toBe(0);
    await expect(markIntroduced(session.id, K("phrase", "нет"), 1, db)).rejects.toThrow(/недоступна/);
    expect(item("p-grafo").isNew).toBe(true);
  });
});

describe("близкие слова в вариантах записи", () => {
  const iso = now.toISOString();
  let n = 0;
  const w = (greek: string, russian: string): Word => ({
    id: `c${String(n++).padStart(3, "0")}`,
    greek,
    russian,
    ipa: "",
    segments: [],
    examples: [],
    verified: false,
    createdAt: iso,
    updatedAt: iso,
  });
  const cat = w("η γάτα", "кошка");
  const mates = [w("ο σκύλος", "собака"), w("το ψάρι", "рыба"), w("το πουλί", "птица")];
  const fillers = Array.from({ length: 10 }, (_, i) => w(`το λέξη${i}`, `слово ${i}`));
  const russian = (list: Word[]) => new Set(list.map((x) => x.russian));
  const count = (options: string[], set: Set<string>) => options.filter((value) => set.has(value)).length;
  /** Слово с тремя соседями по уроку и десять слов словаря вне урока. */
  const seed = async (extra: Word[] = []) => {
    await db.words.bulkAdd([cat, ...mates, ...fillers, ...extra].map(indexWord));
    await db.lessonItems.bulkAdd(
      [cat, ...mates].map((x, position) => ({
        lessonId: "animals",
        unitKey: unitKey(wordRef(x.id)),
        ref: wordRef(x.id),
        position,
      })),
    );
  };
  const failAssembly = async (refs: Word[]) => {
    const session = await makeSession({
      source: source(),
      now,
      refs: refs.map((x) => wordRef(x.id)),
      mode: "practice",
    });
    const item = { ...session.items.find((entry) => entry.ref.id === cat.id)!, type: "assembly" as const };
    const stored = { ...session, items: session.items.map((entry) => (entry.id === item.id ? item : entry)) };
    await db.sessions.add(stored);
    return { stored, item };
  };
  const retryOf = async (stored: Awaited<ReturnType<typeof failAssembly>>["stored"], item: { id: string }) =>
    (await db.sessions.get(stored.id))!.items.find((entry) => entry.retryOf === item.id)!;
  const fail = (session: Awaited<ReturnType<typeof failAssembly>>["stored"], item: (typeof session.items)[number]) =>
    submitAnswer({
      session,
      item,
      correct: false,
      answer: "",
      responseTimeMs: 1200,
      activeTimeMs: 5000,
      timezone: "Asia/Nicosia",
      database: db,
    });

  it("дополнительная попытка после ошибки в сборке берёт два варианта из урока", async () => {
    await seed();
    for (let attempt = 0; attempt < 4; attempt++) {
      await db.sessions.clear();
      await db.events.clear();
      await db.cardStates.clear();
      const { stored, item } = await failAssembly([cat]);
      await fail(stored, item);
      const retry = await retryOf(stored, item);
      expect(retry.type).toBe("recognition");
      expect(count(retry.options, russian(mates))).toBe(2);
    }
  });
  it("слово занятия, убранное после сборки, не попадает в варианты попытки", async () => {
    const dog = w("ο λύκος", "волк");
    await seed([dog]);
    await db.lessonItems.clear(); // единственный близкий кандидат — слово занятия
    const { stored, item } = await failAssembly([cat, dog]);
    await db.words.delete(dog.id);
    await fail(stored, item);
    const retry = await retryOf(stored, item);
    expect(retry.options).toHaveLength(4);
    expect(retry.options).not.toContain("волк");
  });
  it("живое слово занятия идёт в варианты попытки первым", async () => {
    const dog = w("ο λύκος", "волк");
    await seed([dog]);
    await db.lessonItems.clear();
    const { stored, item } = await failAssembly([cat, dog]);
    await fail(stored, item);
    expect((await retryOf(stored, item)).options).toContain("волк");
  });
});
