import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCatalog } from "../src/content/schema";
import { refreshCatalog } from "../src/content/client";
import { AppDatabase } from "../src/storage/db";
import {
  chooseShelfCourse,
  currentLanguage,
  primaryCourse,
  rememberCourses,
  shelfCourse,
  upcomingCourses,
} from "../src/storage/courses";
import { content, memoryFetcher } from "./helpers/content";

const catalog = JSON.parse(content.files.find((file) => file.path === "content/catalog.json")!.body as string) as {
  courses: { id: string; language: string }[];
};
const first = catalog.courses[0];
const b1 = { id: "next", title: "Следующий", language: first.language || "el", level: "A2 → B1", after: first.id };
const withUpcoming = (upcoming: unknown) =>
  memoryFetcher(content, { "content/catalog.json": { ...catalog, upcoming } });

describe("разбор upcoming", () => {
  it("неверные записи отбрасываются, каталог применяется", () => {
    const parsed = parseCatalog({
      ...catalog,
      upcoming: [
        b1,
        { id: "no-title", language: "el" },
        { id: first.id, title: "Совпадает с курсом", language: "el" },
        { id: "bad-level", title: "Уровень", language: "el", level: "B3", after: "unknown" },
        "строка",
      ],
    });
    expect(parsed.courses.length).toBe(catalog.courses.length);
    expect(parsed.upcoming).toEqual([b1, { id: "bad-level", title: "Уровень", language: "el" }]);
  });

  it("неверный вид upcoming и незнакомые поля верхнего уровня каталог не валят", () => {
    expect(() => parseCatalog({ ...catalog, upcoming: "что-то новое", later: [1] })).not.toThrow();
    expect(parseCatalog({ ...catalog, upcoming: "что-то новое" }).upcoming).toEqual([]);
  });
});

describe("курсы в работе на устройстве", () => {
  let db: AppDatabase;
  beforeEach(async () => {
    await new AppDatabase("tetradio-upcoming").delete();
    db = new AppDatabase("tetradio-upcoming");
  });
  afterEach(() => db.close());

  it("каталог сохраняет список, каталог без него — очищает", async () => {
    await refreshCatalog(db, withUpcoming([b1]));
    expect(await upcomingCourses(db)).toEqual([b1]);
    await refreshCatalog(db, memoryFetcher());
    expect(await upcomingCourses(db)).toEqual([]);
  });

  it("выбор курса в работе запоминается и не меняет основной курс и язык", async () => {
    await refreshCatalog(db, withUpcoming([b1]));
    await db.lessons.add({ id: "x-1", courseId: first.id, title: "x", completed: false, updatedAt: "2026-10-27" });
    await rememberCourses(db);
    const [primary, language] = [await primaryCourse(db), await currentLanguage(db)];
    await chooseShelfCourse(b1.id, db);
    expect(await shelfCourse(db)).toBe(b1.id);
    expect(await primaryCourse(db)).toBe(primary);
    expect(await currentLanguage(db)).toBe(language);
    await refreshCatalog(db, memoryFetcher());
    expect(await shelfCourse(db)).toBe(first.id);
  });
});
