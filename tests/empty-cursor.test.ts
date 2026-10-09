import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCourses } from "../src/content/catalog-sync";
import type { ContentFetcher } from "../src/content/fetcher";
import { AppDatabase } from "../src/storage/db";
import { courses, primaryCourse } from "../src/storage/courses";
import { dexieSource } from "../src/storage/queries";

let db: AppDatabase;
const cursors = vi.fn();

beforeEach(async () => {
  await new AppDatabase("tetradio-empty-cursor").delete();
  db = new AppDatabase("tetradio-empty-cursor");
  await db.open();
  cursors.mockClear();
  for (const method of ["openCursor", "openKeyCursor"] as const) {
    const original = IDBIndex.prototype[method];
    vi.spyOn(IDBIndex.prototype, method).mockImplementation(function (this: IDBIndex, ...args) {
      cursors(this.objectStore.name, this.name);
      return Reflect.apply(original, this, args);
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

describe("новый аккаунт: курсор по индексу пустой таблицы WebKit отклоняет с UnknownError", () => {
  it("курсы и основной курс читаются без курсора", async () => {
    expect(await courses(db)).toEqual([]);
    expect(await primaryCourse(db)).toBeUndefined();
    expect(cursors).not.toHaveBeenCalled();
  });
  it("догрузка начатых курсов при запуске — без курсора", async () => {
    await syncCourses(db, {} as ContentFetcher);
    expect(cursors).not.toHaveBeenCalled();
  });
  it("итоги прогресса без ответов — без курсора", async () => {
    expect(await dexieSource(db).totals()).toMatchObject({ answers: 0, cards: 0 });
    expect(cursors).not.toHaveBeenCalled();
  });
});
