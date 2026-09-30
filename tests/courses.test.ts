import { describe, expect, it } from "vitest";
import { groupByCourse, nextLessonIds } from "../src/features/lessons/courses";
import { lessonLabels } from "../src/features/lessons/LessonRow";
import type { CatalogEntry } from "../src/content/schema";
import type { Course } from "../src/domain/types";
import type { LessonView } from "../src/storage/queries";

const iso = "2026-09-16T09:00:00.000Z";
const course = (id: string, over: Partial<Course> = {}): Course => ({
  id,
  title: id,
  origin: "content",
  subscribed: false,
  schedule: { startDate: null, weekdays: [], lessonHour: 12 },
  newItemsPerDay: 10,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
const lesson = (
  id: string,
  courseId: string | undefined,
  wordCount = 10,
  over: Partial<LessonView> = {},
): LessonView => ({
  id,
  courseId,
  title: id,
  targetDate: null,
  status: "upcoming",
  createdAt: iso,
  updatedAt: iso,
  wordCount,
  cardCount: wordCount,
  phraseCount: 0,
  ...over,
});
const entry = (id: string, courseId: string): CatalogEntry => ({
  id,
  courseId,
  language: "el",
  title: id,
  wordCount: 5,
  phraseCount: 0,
  cardCount: 5,
  version: "v1",
  url: `content/packages/${id}@v1.json`,
  bytes: 100,
  media: { count: 0, bytes: 0 },
});

describe("группировка уроков по курсам", () => {
  it("подписанные курсы идут первыми, локальный последним, неизвестный между ними", () => {
    const groups = groupByCourse(
      [
        course("leeke", { subscribed: true, createdAt: "2026-09-01T00:00:00.000Z" }),
        course("other", { createdAt: "2026-09-02T00:00:00.000Z" }),
        course("my", { origin: "local", subscribed: true }),
      ],
      [lesson("l1", "leeke"), lesson("own", "my"), lesson("ghost", undefined)],
      [entry("l2", "leeke"), entry("o1", "other")],
    );
    expect(groups.map((group) => group.id)).toEqual(["leeke", "other", "unknown", "my"]);
  });
  it("в группе курса лежат его установленные уроки и доступные записи каталога", () => {
    const [leeke] = groupByCourse(
      [course("leeke", { subscribed: true, source: "Школа" })],
      [lesson("l1", "leeke", 12)],
      [entry("l2", "leeke"), entry("x", "чужой")],
    );
    expect(leeke.source).toBe("Школа");
    expect(leeke.lessons.map((item) => item.id)).toEqual(["l1"]);
    expect(leeke.available.map((item) => item.id)).toEqual(["l2"]);
  });
  it("пустой курс без уроков и без каталога не показывается", () => {
    expect(
      groupByCourse([course("leeke"), course("my", { origin: "local" })], [], []).map((group) => group.id),
    ).toEqual([]);
  });
  it("урок исчезнувшего из каталога курса остаётся в своей группе", () => {
    const groups = groupByCourse(
      [course("gone", { subscribed: true, title: "Старый курс" })],
      [lesson("l1", "gone")],
      [],
    );
    expect(groups.map((group) => [group.id, group.title, group.available.length])).toEqual([
      ["gone", "Старый курс", 0],
    ]);
  });
});

describe("ближайшее занятие в списке уроков", () => {
  /** Рубеж: занятия этого дня и раньше уже прошли. */
  const today = () => "2026-09-16";
  const dated = (id: string, courseId: string, targetDate: string | null, over: Partial<LessonView> = {}) =>
    lesson(id, courseId, 10, { targetDate, ...over });
  it("у каждого курса своё ближайшее занятие: первый непроведённый урок не раньше сегодня", () => {
    const next = nextLessonIds(
      [
        dated("past", "leeke", "2026-09-14", { status: "completed" }),
        dated("soon", "leeke", "2026-09-18"),
        dated("later", "leeke", "2026-09-21"),
        dated("other", "my", "2026-09-19"),
      ],
      today,
    );
    expect([...next].sort()).toEqual(["other", "soon"]);
  });
  it("урок без даты и урок с прошедшей датой ближайшими не бывают", () => {
    const next = nextLessonIds([dated("none", "leeke", null), dated("overdue", "leeke", "2026-09-10")], today);
    expect([...next]).toEqual([]);
  });
  it("в один день выигрывает созданный раньше", () => {
    const next = nextLessonIds(
      [
        dated("late", "leeke", "2026-09-18", { createdAt: "2026-09-16T12:00:00.000Z" }),
        dated("early", "leeke", "2026-09-18", { createdAt: "2026-09-16T08:00:00.000Z" }),
      ],
      today,
    );
    expect([...next]).toEqual(["early"]);
  });
  it("занятие сегодняшнего дня ведёт список до своего часа и уходит после", () => {
    const lessons = [dated("today", "leeke", "2026-09-17"), dated("next", "leeke", "2026-09-21")];
    expect([...nextLessonIds(lessons, () => "2026-09-16")]).toEqual(["today"]);
    expect([...nextLessonIds(lessons, () => "2026-09-17")]).toEqual(["next"]);
  });
  /** «К пятнице» — срок, к которому готовятся; у прошедшего и дальнего урока день недели ничего не сообщает. */
  it("предлог с днём недели получает только ближайшее занятие", () => {
    const item = dated("soon", "leeke", "2026-09-18");
    expect(lessonLabels(item, true).title).toBe("soon · К пятнице, 18 сентября");
    expect(lessonLabels(item).title).toBe("soon · 18 сентября");
    expect(lessonLabels(dated("none", "leeke", null)).title).toBe("none · Без даты");
    expect(lessonLabels(dated("past", "leeke", "2026-09-14", { status: "completed" })).note).toBe("проведён");
  });
});
