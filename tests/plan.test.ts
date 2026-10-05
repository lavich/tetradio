import { describe, expect, it } from "vitest";
import { createEmptyCard, Rating, State } from "ts-fsrs";
import {
  chooseType,
  localDay,
  makePlan,
  makeSession,
  nextState,
  optionsFor,
  shuffleTiles,
  spellingUnlocked,
} from "../src/domain/learning";
import { fromSnapshot, type Snapshot } from "./helpers/snapshot-source";
import { diffChars } from "../src/domain/spelling";
import { checkAnswer } from "../src/domain/text-answer";
import { progress } from "../src/domain/stats";
import { SESSION_SIZE } from "../src/domain/session";
import {
  type Course,
  type ExerciseType,
  type LearningRef,
  type LearningState,
  type Lesson,
  type LessonItem,
  type Phrase,
  type ReviewEvent,
  type StoredModule,
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
/** Урок по умолчанию пройден: новые карточки берутся только из пройденных. */
const lesson = (id: string, wordIds: string[], over: Partial<Lesson> = {}): LessonSpec => ({
  id,
  title: id,
  completed: true,
  wordIds,
  updatedAt: iso,
  ...over,
});
const course = (id: string, over: Partial<Course> = {}): Course => ({
  id,
  title: id,
  updatedAt: iso,
  ...over,
});
/** Снимок для тестов: состав уроков задаётся массивами и раскладывается в связи с порядком. */
const base = (over: Partial<Omit<Snapshot, "lessons">> & { lessons?: LessonSpec[] } = {}): Snapshot => ({
  words: [],
  states: [],
  events: [],
  sessions: [],
  courses: [course("a2")],
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

const module = (id: string, number: number, over: Partial<StoredModule> = {}): StoredModule => ({
  id,
  courseId: "a2",
  number,
  title: id,
  subtitle: "",
  status: "published",
  goal: "",
  grammar: [],
  sessions: 1,
  lessonIds: [],
  position: number,
  ...over,
});

describe("новые карточки — из пройденных уроков курса", () => {
  const pool = words(60);
  const ids = (from: number, to: number) => pool.slice(from, to).map((w) => w.id);
  it("карточки непройденного урока не вводятся", async () => {
    const data = base({
      words: pool,
      lessons: [
        lesson("done", ids(0, 2), { courseId: "a2" }),
        lesson("missed", ids(2, 20), { courseId: "a2", completed: false }),
        lesson("next", ids(20, 40), { courseId: "a2", completed: false }),
      ],
    });
    const plan = await planOf(data);
    expect(idsOf(plan.newRefs)).toEqual(ids(0, 2));
  });
  it("слово, убранное из урока обновлением, в новые не попадает", async () => {
    // Слово осталось в словаре без связи с уроком и без состояния.
    const data = base({
      words: pool.slice(0, 5),
      lessons: [lesson("done", ids(0, 3), { courseId: "a2" })],
    });
    const plan = await planOf(data);
    expect(idsOf(plan.newRefs)).toEqual(ids(0, 3));
  });
  it("порядок программы: модуль по номеру, уроки модуля, контрольная, повторение; внутри урока — позиция", async () => {
    const data = base({
      words: pool,
      modules: [
        module("m02", 2, { lessonIds: ["m02-1"] }),
        module("m01", 1, { lessonIds: ["m01-1", "m01-2"], checkpointId: "k1", reviewIds: ["r1"] }),
      ],
      // Порядок массива и даты прохождения не важны: важна программа.
      lessons: [
        lesson("r1", ids(8, 10)),
        lesson("m02-1", ids(10, 12)),
        lesson("k1", ids(6, 8)),
        lesson("m01-2", ids(2, 6)),
        lesson("m01-1", ids(0, 2)),
      ],
    });
    expect(idsOf((await planOf(data)).newRefs)).toEqual(ids(0, 12));
  });
  it("уроки вне модулей идут после модулей, в порядке каталога", async () => {
    const data = base({
      words: pool,
      modules: [module("m01", 1, { lessonIds: ["m01-1"] })],
      lessons: [lesson("extra-b", ids(4, 6)), lesson("extra-a", ids(2, 4)), lesson("m01-1", ids(0, 2))],
    });
    expect(idsOf((await planOf(data)).newRefs)).toEqual([...ids(0, 2), ...ids(4, 6), ...ids(2, 4)]);
  });
  it("дневного предела нет: все невведённые карточки пройденных уроков — новые сразу", async () => {
    const introduced = ids(0, 4).map((id) => ({ ...learned(id, "2026-09-16T09:00:00Z"), introducedAt: iso }));
    const data = base({ words: pool, lessons: [lesson("l1", ids(0, 30))], states: introduced });
    expect(idsOf((await planOf(data)).newRefs)).toEqual(ids(4, 30));
  });
  it("карточка двух пройденных уроков вводится один раз и подписана первым по программе", async () => {
    const data = base({ words: pool, lessons: [lesson("l1", ids(0, 3)), lesson("l2", [...ids(1, 3), ...ids(3, 5)])] });
    const plan = await planOf(data);
    expect(idsOf(plan.newRefs)).toEqual(ids(0, 5));
    expect(plan.origins.get(wordKeyOf(pool[1].id))).toEqual({ lessonId: "l1", title: "l1" });
    expect(plan.origins.get(wordKeyOf(pool[4].id))).toEqual({ lessonId: "l2", title: "l2" });
  });
  it("введённая карточка и карточка без записи новыми не считаются", async () => {
    const data = base({
      words: pool.filter((_, index) => index !== 1),
      lessons: [lesson("l1", ids(0, 4))],
      states: [learned(pool[0].id, "2026-09-20T09:00:00Z")],
    });
    const plan = await planOf(data);
    expect(idsOf(plan.newRefs)).toEqual(ids(2, 4));
    expect(plan.reviews).toHaveLength(0); // срок ещё не подошёл, слово просто ждёт
  });
  it("новая карточка в занятии подписана своим уроком", async () => {
    const data = base({ words: pool, lessons: [lesson("Урок 1.2", ids(0, 3))] });
    const session = await sessionOf({ data, now, random: () => 0.5 });
    expect(session.items.filter((item) => item.isNew).every((item) => item.lessonTitle === "Урок 1.2")).toBe(true);
  });
  it("календарь работает по выбранной зоне", () => {
    expect(localDay(new Date("2026-09-15T22:30:00Z"), "Asia/Nicosia")).toBe("2026-09-16");
    expect(localDay(new Date("2026-09-15T22:30:00Z"), "UTC")).toBe("2026-09-15");
  });
});

describe("дневной бюджет и состав занятия", () => {
  const pool = words(30);
  const ids = pool.map((w) => w.id);
  it("смешивает новые и повторения и не превышает размер занятия", async () => {
    const states = ids.slice(20).map((id) => learned(id, "2026-09-15T06:00:00Z"));
    const data = base({ words: pool, lessons: [lesson("l1", ids.slice(0, 20))], states });
    const session = await sessionOf({ data, now, random: () => 0.5 });
    expect(session.items).toHaveLength(20);
    expect(session.items.filter((item) => item.isNew)).toHaveLength(10);
    expect(session.items.filter((item) => !item.isNew)).toHaveLength(10);
  });
  it("вторая сессия в тот же день продолжает вводить новые слова урока, не больше размера занятия", async () => {
    const introduced = ids.slice(0, 10).map((id) => ({ ...learned(id, "2026-09-16T09:00:00Z"), introducedAt: iso }));
    const data = base({ words: pool, lessons: [lesson("l1", ids)], states: introduced });
    expect(idsOf((await planOf(data)).newRefs)).toEqual(ids.slice(10));
    const session = await sessionOf({ data, now, random: () => 0.5 });
    expect(session.items.length).toBeLessThanOrEqual(SESSION_SIZE);
    expect(session.items.some((item) => item.isNew)).toBe(true);
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
    const data = base({ words: pool, lessons: [lesson("l1", ids)] });
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
    ["το σπίτι".normalize("NFD"), "correct"],
    ["το σκύλος", "wrong"],
  ])("«%s» → %s", (answer, status) => expect(checkAnswer(answer, "το σπίτι").status).toBe(status));
  it("конечная сигма и регистр не считаются ошибкой", () => {
    expect(checkAnswer("Ο ΦΊΛΟΣ", "ο φίλος").status).toBe("correct");
    expect(checkAnswer("ο φίλoς", "ο φίλος").status).toBe("wrong"); // латинская o — настоящая ошибка
  });
  it("показывает посимвольно, что совпало, что лишнее и чего не хватает", () => {
    expect(diffChars("το σπιτι", "το σπίτι")).toEqual([
      { type: "same", text: "το σπ" },
      { type: "wrong", text: "ι", fix: "ί" },
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
  it("введённые слова новыми не считаются, дальше по порядку урока идут все фразы", async () => {
    const introduced = ids(0, 2).map((id) =>
      stateOf(W(id), "2026-09-16T09:00:00Z", { introducedAt: "2026-09-15T08:00:00Z" }),
    );
    const refs = [W(pool[0].id), W(pool[1].id), P("p1"), P("p2"), P("q1"), P("q2"), P("q3")];
    const data = base({
      words: pool,
      phrases: all,
      lessons: [lesson("l1", [])],
      items: items("l1", refs),
      states: introduced,
    });
    expect((await planOf(data)).newRefs).toEqual([P("p1"), P("p2"), P("q1"), P("q2"), P("q3")]);
  });
  it("карточки любого вида идут по порядку уроков программы", async () => {
    const data = base({
      words: pool.slice(0, 3),
      phrases: all,
      lessons: [lesson("first", []), lesson("second", [])],
      items: [
        ...items("first", [P("p1"), P("q1"), W(pool[0].id)]),
        ...items("second", [P("q2"), P("p2"), W(pool[1].id), W(pool[2].id)]),
      ],
    });
    const plan = await planOf(data);
    expect(plan.newRefs).toEqual([P("p1"), P("q1"), W(pool[0].id), P("q2"), P("p2"), W(pool[1].id), W(pool[2].id)]);
    expect(plan.origins.get(unitKey(P("q1")))).toEqual({ lessonId: "first", title: "first" });
  });
  it("одинаковые ID разных видов — разные карточки с независимым прогрессом", async () => {
    const twin = [W("x"), P("x")];
    const data = base({
      words: [word("x", 0)],
      phrases: [phrase("x")],
      lessons: [lesson("l1", [])],
      items: items("l1", twin),
      states: [stateOf(W("x"), "2026-09-20T09:00:00Z")],
    });
    const plan = await planOf(data);
    expect(plan.newRefs).toEqual([P("x")]); // слово уже введено, фраза с тем же ID — новая
    expect(new Set(twin.map(unitKey)).size).toBe(2);
  });
  it("фраза без перевода и голоса в новые не попадает, но остаётся видимой отдельно; с голосом и пулом она проверяема", async () => {
    const silent = phrase("p-silent", { translation: undefined });
    const data = base({
      words: [],
      phrases: [...all, silent],
      lessons: [lesson("l1", [])],
      items: items("l1", [P("p-silent"), P("p1"), P("q1")]),
    });
    const plan = await planOf(data);
    expect(plan.newRefs).toEqual([P("p1"), P("q1")]);
    expect(plan.unavailable).toEqual([P("p-silent")]);
    // Системный голос и четыре различных фразы делают аудирование доступным: фраза становится новой.
    const spoken = await makePlan(fromSnapshot(data), now, { hasVoice: true });
    expect(spoken.newRefs).toEqual([P("p-silent"), P("p1"), P("q1")]);
    expect(spoken.unavailable).toEqual([]);
    // Голос есть, но фраз мало — вариантов для аудирования нет: остаётся справочной.
    const few = base({
      words: [],
      phrases: [silent, phrases[0]],
      lessons: [lesson("l1", [])],
      items: items("l1", [P("p-silent"), P("p1")]),
    });
    expect((await makePlan(fromSnapshot(few), now, { hasVoice: true })).unavailable).toEqual([P("p-silent")]);
  });
  it("повторения смешанные и идут по общей очереди", async () => {
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
    ];
    const data = base({
      words: pool,
      phrases: [...phrases, ...extra],
      states,
    });
    const plan = await planOf(data);
    expect(plan.reviews.map((review) => review.ref)).toEqual([W(pool[0].id), P("q1"), P("p1")]);
  });
});
