import { describe, expect, it } from "vitest";
import { createEmptyCard, Rating, State } from "ts-fsrs";
import {
  chooseType,
  daysBetween,
  localDay,
  makePlan,
  makeSession,
  nextState,
  optionsFor,
  shuffleTiles,
  spellingUnlocked,
} from "../src/domain/learning";
import { fromSnapshot } from "../src/domain/snapshot-source";
import { diffChars } from "../src/domain/spelling";
import { checkAnswer } from "../src/domain/import";
import { progress } from "../src/domain/stats";
import {
  defaultSchedule,
  defaultSettings,
  LOCAL_COURSE,
  type Course,
  type ExerciseType,
  type LearningRef,
  type LearningState,
  type Lesson,
  type LessonItem,
  type Phrase,
  type ReviewEvent,
  type Snapshot,
  type Word,
} from "../src/domain/types";
import { idsOf, unitKey, wordEvent, wordKeyOf, wordRef, wordState } from "./helpers/cards";

const now = new Date("2026-09-15T09:00:00Z");
const iso = now.toISOString();
const word = (id: string, index: number): Word => ({
  id,
  greek: `λέξη${index}`,
  russian: `слово${index}`,
  ipa: "",
  segments: [],
  examples: [],
  verified: false,
  createdAt: iso,
  updatedAt: iso,
});
const words = (count: number, prefix = "w") =>
  Array.from({ length: count }, (_, index) => word(`${prefix}${index}`, index));
type LessonSpec = Lesson & { wordIds: string[] };
const lesson = (id: string, wordIds: string[], targetDate: string | null, over: Partial<Lesson> = {}): LessonSpec => ({
  id,
  title: id,
  targetDate,
  status: "upcoming",
  wordIds,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
const course = (id: string, newItemsPerDay: number, over: Partial<Course> = {}): Course => ({
  id,
  title: id,
  origin: "content",
  subscribed: true,
  schedule: defaultSchedule,
  newItemsPerDay,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
/**
 * Снимок для тестов: состав уроков задаётся массивами и раскладывается в связи с порядком.
 * Предел локального курса задан явно: сценарии описывают поведение при пределе 10, а не значение по умолчанию.
 */
const base = (over: Partial<Omit<Snapshot, "lessons">> & { lessons?: LessonSpec[] } = {}): Snapshot => ({
  words: [],
  states: [],
  events: [],
  sessions: [],
  settings: defaultSettings,
  courses: [course(LOCAL_COURSE, 10, { origin: "local", title: "Мои слова" })],
  ...over,
  lessons: (over.lessons ?? []).map(({ wordIds: _, ...rest }) => rest),
  links: (over.lessons ?? []).flatMap((l) =>
    l.wordIds.map((wordId, position) => ({ lessonId: l.id, wordId, position })),
  ),
});
const planOf = (data: Snapshot, at = now) => makePlan(fromSnapshot(data), at);
const sessionOf = (input: Omit<Parameters<typeof makeSession>[0], "source"> & { data: Snapshot }) => {
  const { data, ...rest } = input;
  return makeSession({ source: fromSnapshot(data), ...rest });
};
const learned = (id: string, due: string, state = State.Review): LearningState =>
  wordState(id, {
    introducedAt: "2026-09-01T09:00:00Z",
    version: 1,
    card: { ...createEmptyCard(new Date("2026-09-01")), due: new Date(due), state, scheduled_days: 3, reps: 2 },
  });

describe("очередь ведёт ближайшее занятие", () => {
  const pool = words(60);
  const ids = (from: number, to: number) => pool.slice(from, to).map((w) => w.id);
  it("карточки следующего занятия не берутся, пока ближайшее впереди", async () => {
    const data = base({
      words: pool,
      courses: [course("leeke", 10)],
      lessons: [
        lesson("l3", ids(0, 10), "2026-09-22", { courseId: "leeke" }),
        lesson("l4", ids(10, 45), "2026-09-25", { courseId: "leeke" }),
      ],
      // Все карточки 1.3 уже вводили: срок ещё не наступил, но непоказанных у занятия не осталось.
      states: ids(0, 10).map((id) => learned(id, "2026-09-30T09:00:00Z")),
    });
    const plan = await planOf(data);
    expect(idsOf(plan.newRefs)).toEqual([]);
  });
  it("срок дальнего занятия остаётся в плане с требуемым темпом", async () => {
    const data = base({
      words: pool,
      courses: [course("leeke", 10)],
      lessons: [
        lesson("l3", ids(0, 10), "2026-09-22", { courseId: "leeke" }),
        lesson("l4", ids(10, 45), "2026-09-18", { courseId: "leeke" }),
      ],
      states: ids(0, 10).map((id) => learned(id, "2026-09-30T09:00:00Z")),
    });
    const plan = await planOf(data); // сегодня 2026-09-15, до l4 три дня
    expect(plan.deadlines.map((d) => [d.lessonId, d.newLeft, d.requiredPerDay])).toEqual([
      ["l4", 35, 12],
      ["l3", 35, 5],
    ]);
    expect(plan.shortfall).toBe(true);
    expect(idsOf(plan.newRefs)).toEqual(ids(10, 20)); // ближайшее теперь l4, очередь ведёт оно
  });
  it("добор бюджета не заглядывает в дальние занятия", async () => {
    const data = base({
      words: pool,
      courses: [course("leeke", 10)],
      lessons: [
        lesson("l3", ids(0, 3), "2026-09-22", { courseId: "leeke" }),
        lesson("l4", ids(10, 45), "2026-09-25", { courseId: "leeke" }),
      ],
    });
    const plan = await planOf(data);
    // У ближайшего три непоказанные карточки, бюджет десять — остаток остаётся пустым.
    expect(idsOf(plan.newRefs)).toEqual(ids(0, 3));
  });
});

describe("досрочная подготовка к ближайшему занятию", () => {
  const pool = words(60);
  const ids = (from: number, to: number) => pool.slice(from, to).map((w) => w.id);
  const at = (id: string, due: string, state: State, days: number): LearningState =>
    wordState(id, {
      introducedAt: "2026-09-14T09:00:00Z",
      version: 1,
      card: { ...createEmptyCard(new Date("2026-09-14")), due: new Date(due), state, scheduled_days: days, reps: 2 },
    });
  it("берёт несозревшие карточки ближайшего занятия от наименее зрелых", async () => {
    const data = base({
      words: pool,
      courses: [course("leeke", 10)],
      lessons: [lesson("l3", ids(0, 4), "2026-09-22", { courseId: "leeke" })],
      states: [
        at(pool[0].id, "2026-09-20T09:00:00Z", State.Review, 14),
        at(pool[1].id, "2026-09-16T09:00:00Z", State.Relearning, 0),
        at(pool[2].id, "2026-09-18T09:00:00Z", State.Review, 3),
        at(pool[3].id, "2026-09-16T09:00:00Z", State.Learning, 0),
      ],
    });
    const plan = await planOf(data);
    expect(idsOf(plan.preview)).toEqual([pool[1].id, pool[3].id, pool[2].id, pool[0].id]);
  });
  it("срочная карточка идёт в повторения и в подготовку не попадает", async () => {
    const data = base({
      words: pool,
      courses: [course("leeke", 10)],
      lessons: [lesson("l3", ids(0, 2), "2026-09-22", { courseId: "leeke" })],
      states: [
        at(pool[0].id, "2026-09-14T09:00:00Z", State.Review, 3),
        at(pool[1].id, "2026-09-20T09:00:00Z", State.Review, 3),
      ],
    });
    const plan = await planOf(data);
    expect(plan.reviews.map((r) => r.ref.id)).toEqual([pool[0].id]);
    expect(idsOf(plan.preview)).toEqual([pool[1].id]);
  });
  it("подготовка добирает места, не тронув квоту новых", async () => {
    const data = base({
      words: pool,
      courses: [course("leeke", 10)],
      lessons: [lesson("l3", ids(0, 30), "2026-09-22", { courseId: "leeke" })],
      states: ids(0, 30).map((id) => learned(id, "2026-09-30T09:00:00Z")),
      settings: { ...defaultSettings, sessionSize: 20 },
    });
    const session = await sessionOf({ data, now });
    expect(session.items).toHaveLength(20);
    expect(session.items.every((item) => item.mode === "preview")).toBe(true);
    expect(session.items.every((item) => !item.isNew)).toBe(true);
  });
  it("подготовка не вытесняет новые карточки и повторения", async () => {
    const data = base({
      words: pool,
      courses: [course("leeke", 10)],
      lessons: [lesson("l3", ids(0, 40), "2026-09-22", { courseId: "leeke" })],
      states: [
        ...ids(0, 4).map((id) => learned(id, "2026-09-14T09:00:00Z")), // срочные
        ...ids(4, 20).map((id) => learned(id, "2026-09-30T09:00:00Z")), // подготовка
      ],
      settings: { ...defaultSettings, sessionSize: 20 },
    });
    const session = await sessionOf({ data, now });
    const byMode = (value: string) => session.items.filter((item) => item.mode === value).length;
    expect(session.items.filter((item) => item.isNew)).toHaveLength(10);
    expect(byMode("scheduled")).toBe(14); // 10 новых и 4 повторения
    expect(byMode("preview")).toBe(6);
  });
  it("курс без предстоящих занятий подготовки не даёт", async () => {
    const data = base({
      words: pool,
      courses: [course("leeke", 10)],
      lessons: [lesson("l1", ids(0, 2), "2026-09-10", { courseId: "leeke" })],
      states: [at(pool[0].id, "2026-09-20T09:00:00Z", State.Review, 3)],
    });
    const plan = await planOf(data);
    expect(plan.preview).toEqual([]);
  });
});

describe("темп принадлежит курсу", () => {
  const pool = words(60);
  const ids = (from: number, to: number) => pool.slice(from, to).map((w) => w.id);
  it("каждый курс берёт свой предел, а слова ближнего срока идут первыми", async () => {
    const data = base({
      words: pool,
      courses: [course("near", 10), course("far", 5)],
      lessons: [
        lesson("l-near", ids(0, 20), "2026-09-16", { courseId: "near" }),
        lesson("l-far", ids(20, 40), "2026-09-22", { courseId: "far" }),
      ],
    });
    const plan = await planOf(data);
    expect(plan.courses.map((item) => [item.courseId, item.budget, item.newRefs.length])).toEqual([
      ["near", 10, 10],
      ["far", 5, 5],
    ]);
    expect(idsOf(plan.newRefs).slice(0, 10)).toEqual(ids(0, 10)); // курс с ближайшим занятием идёт раньше
    expect(plan.newRefs).toHaveLength(15);
    expect(plan.budget).toBe(15);
  });
  it("слово из двух курсов вводится один раз и тратит бюджет обоих", async () => {
    const shared = ids(0, 3);
    const data = base({
      words: pool,
      courses: [course("a", 4), course("b", 4)],
      lessons: [
        lesson("la", [...shared, ...ids(10, 14)], "2026-09-18", { courseId: "a" }),
        lesson("lb", [...shared, ...ids(20, 24)], "2026-09-19", { courseId: "b" }),
      ],
      states: shared.map((id) => learned(id, "2026-09-30T09:00:00Z")),
    });
    // Общие слова уже введены: сегодняшний бюджет обоих курсов уменьшен на три.
    const plan = await planOf(data, new Date("2026-09-15T09:00:00Z"));
    expect(plan.courses.map((item) => [item.courseId, item.introducedToday])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
    const same = base({
      words: pool,
      courses: [course("a", 4), course("b", 4)],
      lessons: [
        lesson("la", [...shared, ...ids(10, 14)], "2026-09-18", { courseId: "a" }),
        lesson("lb", [...shared, ...ids(20, 24)], "2026-09-19", { courseId: "b" }),
      ],
      states: shared.map((id) => ({ ...learned(id, "2026-09-30T09:00:00Z"), introducedAt: "2026-09-15T08:00:00Z" })),
    });
    const today = await planOf(same, new Date("2026-09-15T09:00:00Z"));
    expect(today.courses.map((item) => [item.courseId, item.introducedToday, item.budget])).toEqual([
      ["a", 3, 1],
      ["b", 3, 1],
    ]);
  });
  it("нехватка предела считается по курсу и называет его", async () => {
    const data = base({
      words: pool,
      courses: [course("slow", 5), course("calm", 10)],
      lessons: [
        lesson("l-slow", ids(0, 20), "2026-09-17", { courseId: "slow" }),
        lesson("l-calm", ids(20, 25), "2026-09-30", { courseId: "calm" }),
      ],
    });
    const plan = await planOf(data);
    const slow = plan.courses.find((item) => item.courseId === "slow")!;
    expect([slow.requiredPerDay, slow.shortfall]).toEqual([10, true]);
    expect(plan.courses.find((item) => item.courseId === "calm")!.shortfall).toBe(false);
    expect(plan.shortfall).toBe(true); // сводно: хотя бы один курс не успевает
  });
});

describe("подготовка к нескольким занятиям", () => {
  const pool = words(40);
  it("распределяет 30 слов на три дня и предупреждает, когда лимита не хватает", async () => {
    const data = base({
      words: pool,
      lessons: [
        lesson(
          "l1",
          pool.slice(0, 30).map((w) => w.id),
          "2026-09-18",
        ),
      ],
    });
    expect((await planOf(data)).requiredPerDay).toBe(10);
    expect((await planOf(data)).shortfall).toBe(false);
    const urgent = base({
      words: pool,
      lessons: [
        lesson(
          "l1",
          pool.slice(0, 30).map((w) => w.id),
          "2026-09-16",
        ),
      ],
    });
    const plan = await planOf(urgent);
    expect(plan.requiredPerDay).toBe(30);
    expect(plan.shortfall).toBe(true);
    expect(plan.newRefs).toHaveLength(10); // дневной лимит не превышается автоматически
  });
  it("считает общее слово двух наборов один раз по самой ранней дате", async () => {
    const shared = pool.slice(0, 10).map((w) => w.id);
    const data = base({
      words: pool,
      lessons: [
        lesson("l3", shared, "2026-09-17"),
        lesson("l4", [...shared, ...pool.slice(10, 20).map((w) => w.id)], "2026-09-19"),
      ],
    });
    const plan = await planOf(data);
    expect(plan.deadlines.map((d) => [d.newLeft, d.requiredPerDay])).toEqual([
      [10, 5],
      [20, 5],
    ]);
    expect(plan.requiredPerDay).toBe(5);
  });
  it("перенос даты меняет темп, но не трогает уже введённые слова", async () => {
    const ids = pool.slice(0, 30).map((w) => w.id);
    const states = ids.slice(0, 6).map((id) => learned(id, "2026-09-20T09:00:00Z"));
    const moved = base({ words: pool, lessons: [lesson("l1", ids, "2026-09-20")], states });
    const plan = await planOf(moved);
    expect(plan.deadlines[0].newLeft).toBe(24);
    expect(plan.requiredPerDay).toBe(5);
    expect(plan.newRefs.every((ref) => !states.some((state) => state.ref.id === ref.id))).toBe(true);
  });
  it("прошедший урок не исчезает: слова идут в общей очереди", async () => {
    const data = base({
      words: pool.slice(0, 3),
      lessons: [
        lesson(
          "old",
          pool.slice(0, 3).map((w) => w.id),
          "2026-09-10",
        ),
      ],
    });
    const plan = await planOf(data);
    expect(plan.deadlines).toHaveLength(0);
    expect(plan.newRefs).toHaveLength(3);
  });
  it("слова ближайшего занятия идут раньше хвоста прошедших", async () => {
    const late = pool.slice(0, 4).map((w) => w.id),
      soon = pool.slice(10, 30).map((w) => w.id);
    const data = base({
      words: pool,
      lessons: [
        lesson("done", late.slice(0, 2), "2026-09-08", { status: "completed" }), // помечен пройденным
        lesson("missed", late.slice(2), "2026-09-12"), // дата прошла, статус остался прежним
        lesson("next", soon, "2026-09-18"),
      ],
    });
    const plan = await planOf(data);
    expect(plan.backlog).toEqual({ refs: late.map(wordRef), lessons: 2 });
    expect(idsOf(plan.newRefs)).toEqual(soon.slice(0, 10));
    expect(plan.deadlines[0].newLeft).toBe(20);
    expect(plan.deadlines[0].requiredPerDay).toBe(7);
    expect(plan.origins.get(wordKeyOf(soon[0]))).toEqual({ lessonId: "next", title: "next", past: false });
    expect(plan.origins.get(wordKeyOf(late[0]))).toEqual({ lessonId: "done", title: "done", past: true });
  });
  it("хвост добирает остаток бюджета после слов ближайшего занятия", async () => {
    const late = pool.slice(0, 4).map((w) => w.id),
      soon = pool.slice(10, 16).map((w) => w.id),
      later = pool.slice(20, 30).map((w) => w.id);
    const data = base({
      words: pool,
      lessons: [
        lesson("done", late, "2026-09-08", { status: "completed" }),
        lesson("next", soon, "2026-09-18"),
        lesson("later", later, null),
      ],
    });
    const plan = await planOf(data);
    expect(idsOf(plan.newRefs)).toEqual([...soon, ...late]);
    expect(plan.deadlines[0].newLeft).toBe(6);
    const session = await sessionOf({ data, now, random: () => 0.5 });
    const fresh = session.items.filter((item) => item.isNew);
    expect(
      fresh
        .filter((item) => soon.includes(item.ref.id))
        .every((item) => item.lessonTitle === "next" && item.lessonPast === false),
    ).toBe(true);
    expect(
      fresh
        .filter((item) => late.includes(item.ref.id))
        .every((item) => item.lessonTitle === "done" && item.lessonPast === true),
    ).toBe(true);
    expect(fresh.length).toBe(10);
  });
  it("скан словаря локального курса не берёт слова уроков другого курса", async () => {
    const foreign = pool.slice(0, 5).map((w) => w.id),
      loose = pool.slice(40, 43).map((w) => w.id);
    const data = base({
      words: [...pool.slice(0, 5), ...pool.slice(40, 43)],
      courses: [course("leeke", 10), course("my", 10, { origin: "local" })],
      lessons: [lesson("done", foreign, null, { status: "completed", courseId: "leeke" })],
    });
    const plan = await planOf(data);
    const local = plan.courses.find((item) => item.courseId === "my")!;
    expect(idsOf(local.newRefs)).toEqual(loose);
    expect(idsOf(plan.newRefs)).toEqual([...foreign, ...loose]);
  });
  it("введённое слово прошедшего занятия в хвост не попадает: его ведёт повторение", async () => {
    const ids = pool.slice(0, 3).map((w) => w.id);
    // Урок 1.1 в поставке именно такой: пройден, даты нет.
    const data = base({
      words: pool,
      states: [learned(ids[0], "2026-09-20T09:00:00Z")],
      lessons: [lesson("done", ids, null, { status: "completed" })],
    });
    const plan = await planOf(data);
    expect(plan.backlog).toEqual({ refs: ids.slice(1).map(wordRef), lessons: 1 });
    expect(plan.reviews).toHaveLength(0); // срок ещё не подошёл, слово просто ждёт
  });
  it("без прошедших занятий хвоста нет", async () => {
    const plan = await planOf(
      base({
        words: pool,
        lessons: [
          lesson(
            "next",
            pool.slice(0, 5).map((w) => w.id),
            "2026-09-18",
          ),
        ],
      }),
    );
    expect(plan.backlog).toEqual({ refs: [], lessons: 0 });
  });
  it("день занятия до часа занятия считается догоняющей подготовкой с делителем один", async () => {
    const ids = pool.slice(0, 8).map((w) => w.id);
    // 09:00 в Asia/Nicosia: час занятия (12) ещё не настал, поэтому сегодняшний урок остаётся предстоящим.
    const plan = await planOf(
      base({ words: pool, lessons: [lesson("today", ids, "2026-09-15")] }),
      new Date("2026-09-15T06:00:00Z"),
    );
    expect(plan.deadlines[0].daysLeft).toBe(0);
    expect(plan.deadlines[0].requiredPerDay).toBe(8);
  });
  it("календарь работает по выбранной зоне и переживает переход летнего времени", () => {
    expect(localDay(new Date("2026-09-15T22:30:00Z"), "Asia/Nicosia")).toBe("2026-09-16");
    expect(localDay(new Date("2026-09-15T22:30:00Z"), "UTC")).toBe("2026-09-15");
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-09-18", "2026-09-15")).toBe(-3);
  });
});

describe("дневной бюджет и состав занятия", () => {
  const pool = words(30);
  const ids = pool.map((w) => w.id);
  it("смешивает новые и повторения и не превышает размер занятия", async () => {
    const states = ids.slice(20).map((id) => learned(id, "2026-09-15T06:00:00Z"));
    const data = base({ words: pool, lessons: [lesson("l1", ids.slice(0, 20), "2026-09-18")], states });
    const session = await sessionOf({ data, now, random: () => 0.5 });
    expect(session.items).toHaveLength(20);
    expect(session.items.filter((item) => item.isNew)).toHaveLength(10);
    expect(session.items.filter((item) => !item.isNew)).toHaveLength(10);
  });
  it("вторая сессия в тот же день не выдаёт новых слов сверх лимита", async () => {
    const introduced = ids.slice(0, 10).map((id) => ({ ...learned(id, "2026-09-16T09:00:00Z"), introducedAt: iso }));
    const data = base({ words: pool, lessons: [lesson("l1", ids, "2026-09-18")], states: introduced });
    const plan = await planOf(data);
    expect(plan.introducedToday).toBe(10);
    expect(plan.budget).toBe(0);
    expect((await sessionOf({ data, now, random: () => 0.5 })).items.every((item) => !item.isNew)).toBe(true);
  });
  it("сначала relearning, затем просроченные, затем сегодняшние", async () => {
    const states = [
      learned(ids[0], "2026-09-15T08:00:00Z"),
      learned(ids[1], "2026-09-12T08:00:00Z"),
      { ...learned(ids[2], "2026-09-14T08:00:00Z", State.Relearning) },
    ];
    const plan = await planOf(base({ words: pool, states }));
    expect(plan.reviews.map((review) => review.ref.id)).toEqual([ids[2], ids[1], ids[0]]);
  });
  it("аудирование доступно и без своего файла, если есть системный греческий голос", async () => {
    const history = (["recall", "recognition", "assembly", "spelling"] as ExerciseType[]).map((type, index) =>
      wordEvent(ids[0], {
        id: `${type}`,
        sessionId: "s",
        itemId: `${type}`,
        snapshot: { greek: "", russian: "" },
        type,
        mode: "scheduled" as const,
        rating: 3 as const,
        correct: true,
        answer: "",
        createdAt: `2026-09-1${index}T09:00:00Z`,
        localDate: `2026-09-1${index}`,
        responseTimeMs: 900,
      }),
    );
    const data = base({ words: pool, states: [learned(ids[0], "2026-09-14T08:00:00Z")], events: history });
    const silent = (await sessionOf({ data, now, random: () => 0.5, hasVoice: false })).items.find(
      (item) => item.ref.id === ids[0],
    )!;
    expect(silent.type).not.toBe("listening");
    const spoken = (await sessionOf({ data, now, random: () => 0.5, hasVoice: true })).items.find(
      (item) => item.ref.id === ids[0],
    )!;
    expect(spoken.type).toBe("listening");
    expect(new Set(spoken.options).size).toBe(4);
  });
  it("плитки перемешиваются и не выпадают сразу в правильном порядке", () => {
    const parts = ["το", "σπί", "τι"];
    const mixed = shuffleTiles(parts, () => 0.5);
    expect([...mixed].sort()).toEqual([...parts].sort());
    expect(mixed.join("")).not.toBe(parts.join(""));
  });
  it("ручная тренировка набора берёт указанные слова в режиме practice", async () => {
    const data = base({ words: pool, lessons: [lesson("l1", ids, "2026-09-18")] });
    const session = await sessionOf({
      data,
      now,
      random: () => 0.5,
      mode: "practice",
      refs: ids.slice(0, 3).map(wordRef),
    });
    expect(idsOf(session.items.map((item) => item.ref))).toEqual(ids.slice(0, 3));
    expect(session.items.every((item) => item.mode === "practice")).toBe(true);
  });
  it("варианты ответа уникальны, а при нехватке слов упражнение заменяется на сборку", async () => {
    const options = optionsFor(pool[0], { close: [], pool }, "recognition", () => 0.5);
    expect(new Set(options).size).toBe(4);
    expect(options).toContain(pool[0].russian);
    expect(optionsFor(pool[0], { close: [], pool: pool.slice(0, 3) }, "recognition", () => 0.5)).toEqual([]);
    const small = base({ words: pool.slice(0, 2), states: [learned(ids[0], "2026-09-14T08:00:00Z")] });
    expect((await sessionOf({ data: small, now, random: () => 0.5 })).items[0].type).not.toBe("recognition");
  });
});

describe("интервалы FSRS", () => {
  const later = (rating: 1 | 2 | 3 | 4) => nextState(undefined, wordRef("w0"), rating as never, now).card;
  it("сохраняет состояние и даёт больший интервал за Легко, чем за Хорошо", () => {
    expect(later(Rating.Again).state).toBe(State.Learning);
    expect(later(Rating.Easy).due.getTime()).toBeGreaterThan(later(Rating.Good).due.getTime());
    expect(later(Rating.Good).due.getTime()).toBeGreaterThan(later(Rating.Again).due.getTime());
    expect(later(Rating.Hard).stability).toBeGreaterThan(0);
  });
  it("после Again слово возвращается позже, а не бесконечно в этой же сессии", () => {
    const state = nextState(undefined, wordRef("w0"), Rating.Again, now);
    expect(state.card.due.getTime()).toBeGreaterThan(now.getTime());
    expect(state.version).toBe(1);
    const repeated = nextState(state, wordRef("w0"), Rating.Good, new Date("2026-09-15T09:10:00Z"));
    expect(repeated.version).toBe(2);
    expect(repeated.introducedAt).toBe(state.introducedAt);
  });
});

describe("выбор упражнения", () => {
  const W0 = wordKeyOf("w0");
  const event = (type: ExerciseType, correct: boolean, at: string): ReviewEvent =>
    wordEvent("w0", {
      id: `${type}-${at}`,
      sessionId: "s",
      itemId: `${type}-${at}`,
      snapshot: { greek: "", russian: "" },
      type,
      mode: "scheduled",
      rating: correct ? 3 : 1,
      correct,
      answer: "",
      createdAt: at,
      localDate: at.slice(0, 10),
      responseTimeMs: 1000,
    });
  it("сначала проверяет ещё не испытанные навыки в заданном порядке", () => {
    expect(chooseType(W0, [], {})).toBe("recognition");
    expect(chooseType(W0, [event("recall", true, "2026-09-10T09:00:00Z")], {})).toBe("recognition");
    expect(
      chooseType(
        W0,
        [event("recall", true, "2026-09-10T09:00:00Z"), event("recognition", true, "2026-09-11T09:00:00Z")],
        {},
      ),
    ).toBe("spelling");
  });
  it("аудирование не предлагается без аудио, а варианты — без набора слов", () => {
    const history = (["recall", "recognition", "spelling"] as ExerciseType[]).map((type, index) =>
      event(type, true, `2026-09-1${index}T09:00:00Z`),
    );
    expect(chooseType(W0, history, {})).not.toBe("listening");
    expect(chooseType(W0, history, { hasAudio: true })).toBe("listening");
    expect(chooseType(W0, history, { hasOptions: false })).not.toBe("recognition");
  });
  it("сборка предлагается раньше написания, а написание ждёт чистой сборки", () => {
    const tested = [event("recall", true, "2026-09-10T09:00:00Z"), event("recognition", true, "2026-09-11T09:00:00Z")];
    expect(chooseType(W0, tested, { canAssemble: true })).toBe("assembly");
    expect(spellingUnlocked(W0, tested)).toBe(false);
    const one = [...tested, event("assembly", true, "2026-09-12T09:00:00Z")];
    expect(spellingUnlocked(W0, one)).toBe(true);
    expect(chooseType(W0, one, { canAssemble: true })).toBe("spelling");
  });
  it("письмо приходит третьим заданием слова со всеми доступными проверками", () => {
    // Сборка показывает все буквы и проверяет их порядок; продукция не должна ждать дольше этого.
    const full = { hasAudio: true, hasOptions: true, canAssemble: true, canComprehend: true };
    expect(chooseType(W0, [], full)).toBe("recognition");
    const first = [event("recognition", true, "2026-09-11T09:00:00Z")];
    expect(chooseType(W0, first, full)).toBe("assembly");
    const second = [...first, event("assembly", true, "2026-09-12T09:00:00Z")];
    expect(chooseType(W0, second, full)).toBe("spelling");
  });
  it("ошибка в написании возвращает слово к сборке", () => {
    const history = [
      event("recall", true, "2026-09-10T09:00:00Z"),
      event("recognition", true, "2026-09-11T09:00:00Z"),
      event("assembly", true, "2026-09-12T09:00:00Z"),
      event("assembly", true, "2026-09-13T09:00:00Z"),
      event("spelling", false, "2026-09-14T09:00:00Z"),
    ];
    expect(spellingUnlocked(W0, history)).toBe(false);
    expect(chooseType(W0, history, { canAssemble: true })).not.toBe("spelling");
    const recovered = [...history, event("assembly", true, "2026-09-15T09:00:00Z")];
    expect(spellingUnlocked(W0, recovered)).toBe(true);
  });
  it("без слогов написание не блокируется", () => {
    const tested = [event("recall", true, "2026-09-10T09:00:00Z"), event("recognition", true, "2026-09-11T09:00:00Z")];
    expect(chooseType(W0, tested, { canAssemble: false })).toBe("spelling");
  });
  it("выбирает самый слабый навык по последним ответам", () => {
    const history = [
      event("recall", true, "2026-09-10T09:00:00Z"),
      event("recognition", true, "2026-09-11T09:00:00Z"),
      event("spelling", false, "2026-09-12T09:00:00Z"),
      event("listening", true, "2026-09-13T09:00:00Z"),
    ];
    expect(chooseType(W0, history, { hasAudio: true })).toBe("spelling");
  });
  it("не повторяет один тип три раза подряд", () => {
    const history = [
      event("recognition", true, "2026-09-10T09:00:00Z"),
      event("listening", true, "2026-09-11T09:00:00Z"),
      event("recall", false, "2026-09-12T09:00:00Z"),
      event("spelling", true, "2026-09-13T09:00:00Z"),
      event("spelling", true, "2026-09-14T09:00:00Z"),
    ];
    expect(chooseType(W0, history, { hasAudio: true })).not.toBe("spelling");
  });
});

describe("проверка написания", () => {
  it.each([
    ["το σπίτι", "correct"],
    [" ΤΟ ΣΠΊΤΙ ", "correct"],
    ["το  σπίτι", "correct"],
    ["το σπιτι", "almost"],
    ["σπίτι", "almost"],
    ["το σπίτη", "wrong"],
    ["ο σπίτι", "almost"],
  ])("«%s» → %s", (answer, status) => expect(checkAnswer(answer, "το σπίτι").status).toBe(status));
  it("конечная сигма и регистр не считаются ошибкой", () => {
    expect(checkAnswer("Ο ΦΊΛΟΣ", "ο φίλος").status).toBe("correct");
    expect(checkAnswer("ο φίλoς", "ο φίλος").status).toBe("wrong"); // латинская o — настоящая ошибка
  });
  it("показывает посимвольно, что совпало, что лишнее и чего не хватает", () => {
    expect(diffChars("το σπιτι", "το σπίτι")).toEqual([
      { type: "same", text: "το σπ" },
      { type: "wrong", text: "ι" },
      { type: "same", text: "τι" },
    ]);
    expect(diffChars("σπίτι", "το σπίτι")).toEqual([
      { type: "missing", text: "το " },
      { type: "same", text: "σπίτι" },
    ]);
  });
});

describe("статистика", () => {
  it("без истории не выдумывает оценку запоминания", async () => {
    const stats = await progress(fromSnapshot(base({ words: words(3) })), now);
    expect(stats.skills.every((skill) => skill.rate === null)).toBe(true);
    expect(stats.days).toHaveLength(7);
    expect(stats.groups.fresh).toBe(3);
  });
  it("сроки считает по календарю выбранной зоны, а не по суткам UTC", async () => {
    const pool = words(2);
    // 22:00 UTC — это уже 01:00 следующего дня в Никосии, значит «сегодня» такое повторение не готово.
    const states = [
      { ...learned(pool[0].id, "2026-09-15T22:00:00Z") },
      { ...learned(pool[1].id, "2026-09-15T12:00:00Z") },
    ];
    const stats = await progress(fromSnapshot(base({ words: pool, states })), now);
    expect(stats.due.today).toBe(1);
    expect(stats.due.tomorrow).toBe(2);
  });
  it("считает дни по локальной полуночи выбранной зоны", async () => {
    const pool = words(2);
    const events: ReviewEvent[] = [
      wordEvent(pool[0].id, {
        id: "e1",
        sessionId: "s",
        itemId: "i1",
        snapshot: { greek: "", russian: "" },
        type: "recall",
        mode: "scheduled",
        rating: 3,
        correct: null,
        answer: "",
        createdAt: "2026-09-14T22:30:00Z",
        localDate: localDay(new Date("2026-09-14T22:30:00Z"), "Asia/Nicosia"),
        responseTimeMs: 900,
      }),
    ];
    const stats = await progress(fromSnapshot(base({ words: pool, events })), now);
    expect(stats.days.find((day) => day.date === "2026-09-15")!.answers).toBe(1);
  });
});

/** Смешанные сценарии: карточки трёх видов в одном плане; словарные сценарии выше остаются эталоном. */
describe("дневной план со смешанными карточками", () => {
  const pool = words(40);
  const ids = (from: number, to: number) => pool.slice(from, to).map((w) => w.id);
  const phrase = (id: string, over: Partial<Phrase> = {}): Phrase => ({
    id,
    text: `Φράση ${id}.`,
    translation: `Фраза ${id}.`,
    provenance: { sourceLabel: "тест", operation: "verbatim" },
    createdAt: iso,
    updatedAt: iso,
    ...over,
  });
  const P = (id: string): LearningRef => ({ kind: "phrase", id }),
    W = wordRef;
  const items = (lessonId: string, refs: LearningRef[]): LessonItem[] =>
    refs.map((ref, position) => ({ lessonId, unitKey: unitKey(ref), ref, position }));
  const stateOf = (ref: LearningRef, due: string, over: Partial<LearningState> = {}): LearningState => ({
    unitKey: unitKey(ref),
    ref,
    introducedAt: "2026-09-01T09:00:00Z",
    version: 1,
    card: {
      ...createEmptyCard(new Date("2026-09-01")),
      due: new Date(due),
      state: State.Review,
      scheduled_days: 3,
      reps: 2,
    },
    ...over,
  });
  const phrases = ["p1", "p2", "p3", "p4", "p5"].map((id) => phrase(id));
  /** Второй набор фраз: раньше эти места в сценариях занимали карточки снятого вида. */
  const extra = ["q1", "q2", "q3", "q4"].map((id) => phrase(id));
  const all = [...phrases, ...extra];
  it("смешанная квота: предел 5, введены 2 слова, дальше по порядку урока 5 фраз → 3 фразы", async () => {
    const introduced = ids(0, 2).map((id) =>
      stateOf(W(id), "2026-09-16T09:00:00Z", { introducedAt: "2026-09-15T08:00:00Z" }),
    );
    const refs = [W(pool[0].id), W(pool[1].id), P("p1"), P("p2"), P("q1"), P("q2"), P("q3")];
    const data = base({
      words: pool,
      phrases: all,
      courses: [course("my", 5, { origin: "local" })],
      lessons: [lesson("l1", [], "2026-09-18", { courseId: "my" })],
      items: items("l1", refs),
      states: introduced,
    });
    const plan = await planOf(data);
    expect(plan.introducedToday).toBe(2);
    expect(plan.budget).toBe(3);
    expect(plan.newRefs).toEqual([P("p1"), P("p2"), P("q1")]);
    expect(plan.courses[0].introducedToday + plan.newRefs.length).toBeLessThanOrEqual(5);
    expect(plan.deadlines[0].newLeft).toBe(5); // пять фраз к сроку
  });
  it("ближайший срок раньше хвоста; хвост состоит из карточек любого вида и добирает остаток бюджета", async () => {
    const data = base({
      words: pool.slice(0, 3),
      phrases: all,
      lessons: [lesson("done", [], "2026-09-08", { status: "completed" }), lesson("next", [], "2026-09-18")],
      items: [
        ...items("done", [P("p1"), P("q1"), W(pool[0].id)]),
        ...items("next", [P("q2"), P("p2"), W(pool[1].id), W(pool[2].id)]),
      ],
    });
    const plan = await planOf(data);
    expect(plan.newRefs).toEqual([P("q2"), P("p2"), W(pool[1].id), W(pool[2].id), P("p1"), P("q1"), W(pool[0].id)]);
    expect(plan.backlog).toEqual({ refs: [P("p1"), P("q1"), W(pool[0].id)], lessons: 1 });
    expect(plan.deadlines[0].newLeft).toBe(4);
    expect(plan.origins.get(unitKey(P("q1")))).toEqual({ lessonId: "done", title: "done", past: true });
  });
  it("общая карточка двух курсов вводится один раз и списывается с обоих бюджетов", async () => {
    const shared = [P("p1"), P("q1")];
    const lessons = [
      lesson("la", [], "2026-09-18", { courseId: "a" }),
      lesson("lb", [], "2026-09-19", { courseId: "b" }),
    ];
    const linked = [...items("la", [...shared, W(pool[0].id)]), ...items("lb", [...shared, W(pool[1].id)])];
    const plan = await planOf(
      base({ words: pool, phrases: all, courses: [course("a", 3), course("b", 3)], lessons, items: linked }),
    );
    expect(plan.newRefs).toEqual([P("p1"), P("q1"), W(pool[0].id), W(pool[1].id)]);
    expect(plan.courses.map((item) => [item.courseId, item.newRefs.length])).toEqual([
      ["a", 3],
      ["b", 3],
    ]);
    const today = await planOf(
      base({
        words: pool,
        phrases: all,
        courses: [course("a", 3), course("b", 3)],
        lessons,
        items: linked,
        states: shared.map((ref) => stateOf(ref, "2026-09-30T09:00:00Z", { introducedAt: "2026-09-15T08:00:00Z" })),
      }),
    );
    expect(today.courses.map((item) => [item.courseId, item.introducedToday, item.budget])).toEqual([
      ["a", 2, 1],
      ["b", 2, 1],
    ]);
  });
  it("одинаковые ID разных видов — разные карточки с независимым прогрессом", async () => {
    const twin = [W("x"), P("x")];
    const data = base({
      words: [word("x", 0)],
      phrases: [phrase("x")],
      lessons: [lesson("l1", [], "2026-09-18")],
      items: items("l1", twin),
      states: [stateOf(W("x"), "2026-09-20T09:00:00Z")],
    });
    const plan = await planOf(data);
    expect(plan.newRefs).toEqual([P("x")]); // слово уже введено, фраза с тем же ID — новая
    expect(new Set(twin.map(unitKey)).size).toBe(2);
  });
  it("фраза без перевода и голоса не расходует квоту и темп, но остаётся видимой отдельно; с голосом и пулом она проверяема", async () => {
    const silent = phrase("p-silent", { translation: undefined });
    const data = base({
      words: [],
      phrases: [...all, silent],
      courses: [course("my", 10, { origin: "local" })],
      lessons: [lesson("l1", [], "2026-09-18", { courseId: "my" })],
      items: items("l1", [P("p-silent"), P("p1"), P("q1")]),
    });
    const plan = await planOf(data);
    expect(plan.newRefs).toEqual([P("p1"), P("q1")]);
    expect(plan.unavailable).toEqual([P("p-silent")]);
    expect(plan.deadlines[0].newLeft).toBe(2);
    expect(plan.deadlines[0].requiredPerDay).toBe(1);
    // Системный голос и четыре различных фразы делают аудирование доступным: фраза входит в квоту.
    const spoken = await makePlan(fromSnapshot(data), now, { hasVoice: true });
    expect(spoken.newRefs).toEqual([P("p-silent"), P("p1"), P("q1")]);
    expect(spoken.unavailable).toEqual([]);
    // Голос есть, но фраз мало — вариантов для аудирования нет: остаётся справочной.
    const few = base({
      words: [],
      phrases: [silent, phrases[0]],
      lessons: [lesson("l1", [], "2026-09-18")],
      items: items("l1", [P("p-silent"), P("p1")]),
    });
    expect((await makePlan(fromSnapshot(few), now, { hasVoice: true })).unavailable).toEqual([P("p-silent")]);
  });
  it("повторения смешанные и идут по общей очереди; удалённая карточка выпадает", async () => {
    const states = [
      stateOf(P("p1"), "2026-09-15T08:00:00Z"),
      stateOf(P("q1"), "2026-09-12T08:00:00Z"),
      stateOf(W(pool[0].id), "2026-09-14T08:00:00Z", {
        card: {
          ...createEmptyCard(new Date("2026-09-01")),
          due: new Date("2026-09-14T08:00:00Z"),
          state: State.Relearning,
          scheduled_days: 0,
          reps: 2,
        } as LearningState["card"],
      }),
      stateOf(P("q2"), "2026-09-13T08:00:00Z"),
    ];
    const data = base({
      words: pool,
      phrases: [...phrases, extra[0], { ...extra[1], deletedAt: iso }, ...extra.slice(2)],
      states,
    });
    const plan = await planOf(data);
    expect(plan.reviews.map((review) => review.ref)).toEqual([W(pool[0].id), P("q1"), P("p1")]);
  });
});

describe("подготовка кончается в час занятия", () => {
  const pool = words(40, "h");
  const ids = (from: number, to: number) => pool.slice(from, to).map((w) => w.id);
  /** Занятие сегодня: его карточки уже вводили, у следующего все новые. */
  const data = (lessonHour = 12, introducedToday = 0) =>
    base({
      words: pool,
      courses: [course("leeke", 12, { schedule: { ...defaultSchedule, lessonHour } })],
      lessons: [
        lesson("l3", ids(0, 10), "2026-09-15", { courseId: "leeke" }),
        lesson("l4", ids(10, 30), "2026-09-18", { courseId: "leeke" }),
      ],
      states: [
        ...ids(0, 10).map((id) => learned(id, "2026-09-30T09:00:00Z")),
        ...ids(10, 10 + introducedToday).map((id) =>
          wordState(id, {
            introducedAt: "2026-09-15T06:00:00Z",
            version: 1,
            card: { ...createEmptyCard(new Date("2026-09-15")), due: new Date("2026-09-30T09:00:00Z") },
          }),
        ),
      ],
    });

  it("до часа занятия очередь держит сегодняшний урок", async () => {
    const plan = await planOf(data(), new Date("2026-09-15T06:00:00Z"));
    expect(idsOf(plan.newRefs)).toEqual([]);
    expect(plan.deadlines[0]?.lessonId).toBe("l3");
  });
  it("ровно в час занятия очередь переходит к следующему уроку", async () => {
    const plan = await planOf(data(), new Date("2026-09-15T09:00:00Z"));
    expect(idsOf(plan.newRefs)).toEqual(ids(10, 22));
    expect(plan.deadlines[0]?.lessonId).toBe("l4");
  });
  it("час занятия у каждого курса свой", async () => {
    const early = await planOf(data(9), new Date("2026-09-15T07:00:00Z"));
    const late = await planOf(data(18), new Date("2026-09-15T07:00:00Z"));
    expect(early.deadlines[0]?.lessonId).toBe("l4");
    expect(late.deadlines[0]?.lessonId).toBe("l3");
  });
  it("смена ближайшего занятия не выдаёт дневной бюджет заново", async () => {
    const plan = await planOf(data(12, 12), new Date("2026-09-15T09:00:00Z"));
    expect(idsOf(plan.newRefs)).toEqual([]);
  });
});
