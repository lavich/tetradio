import "fake-indexeddb/auto";
import "./helpers/self";
import Dexie from "dexie";
import { exportDB } from "dexie-export-import";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { inspectBackup, restoreBackup } from "../src/features/backup/backup";
import { dexieSource } from "../src/storage/queries";
import { dictionary } from "../src/storage/dictionary";
import { courseProgress } from "../src/storage/progress";
import { makePlan } from "../src/domain/learning";
import { progress } from "../src/domain/stats";
import { seedV8, v8Catalog, V8_NOW, V8_STORES } from "./helpers/v8";

const NAME = "tetradio-v8-copy";
let db: AppDatabase;
beforeEach(async () => {
  await Dexie.delete(NAME);
  await seedV8(NAME);
  db = new AppDatabase(NAME);
  await db.open();
});
afterEach(async () => {
  db.close();
  await Dexie.delete(NAME);
});

async function views(database: AppDatabase) {
  // Календаря в копии v8 нет: его приносит каталог при первом запуске после обновления.
  const course = v8Catalog.courses[0];
  await database.courses.update(course.id, { calendar: course.calendar });
  const plan = await makePlan(dexieSource(database), V8_NOW);
  return {
    plan: {
      ...plan,
      reviews: plan.reviews.map((review) => review.state.unitKey),
      origins: [...plan.origins],
    },
    dictionary: (await dictionary(database)).map((lesson) => ({
      ...lesson,
      entries: lesson.entries.map(({ key, greek, russian, mark }) => ({ key, greek, russian, mark })),
    })),
    course: await courseProgress(V8_NOW, "Asia/Nicosia", database),
    stats: await progress(dexieSource(database), V8_NOW),
  };
}

/** Файл копии v8, как его сделало приложение до обновления. */
async function backupV8(): Promise<Blob> {
  const name = "tetradio-v8-file";
  await seedV8(name);
  const legacy = new Dexie(name);
  legacy.version(8).stores(V8_STORES);
  await legacy.open();
  await legacy.table("meta").put({ key: "app", value: "tetradio:8" });
  const file = await exportDB(legacy, {
    skipTables: ["catalog", "modules", "syncVersions", "lessonWords", "states", "baseSkills", "syncStash", "clozes"],
  });
  legacy.close();
  await Dexie.delete(name);
  return file;
}

describe("обновление копии v8", () => {
  it("план, словарь, «Прогресс» и статистика совпадают с исходными", async () => {
    expect(await views(db)).toMatchInlineSnapshot(`
      {
        "course": {
          "calendar": {
            "checkpoints": [
              {
                "afterModule": 2,
                "date": "2026-12-13",
                "label": "K1",
                "title": "Контрольная A1",
              },
            ],
            "start": "2026-10-05",
          },
          "complete": true,
          "current": 1,
          "pace": {
            "done": 2,
            "lagWeeks": 0,
            "next": {
              "checkpoint": {
                "afterModule": 2,
                "date": "2026-12-13",
                "label": "K1",
                "title": "Контрольная A1",
              },
              "perWeek": 0.5,
              "remaining": 5,
            },
            "planned": 0,
            "recentPerWeek": 1,
            "total": 7,
          },
          "passShare": 0.6,
          "skills": [
            {
              "attempted": 4,
              "earned": 2,
              "skill": "reading",
              "source": "task",
              "total": 4,
            },
            {
              "attempted": 2,
              "earned": 0,
              "skill": "listening",
              "source": "task",
              "total": 2,
            },
            {
              "attempted": 4,
              "earned": 1,
              "skill": "writing",
              "source": "self",
              "total": 4,
            },
            {
              "attempted": 3,
              "earned": 1,
              "skill": "speaking",
              "source": "self",
              "total": 3,
            },
          ],
          "views": [
            {
              "checkpoint": {
                "completed": false,
                "id": "m01-k1",
                "installed": true,
                "kind": "test",
                "tally": {
                  "done": 0,
                  "total": 1,
                },
                "title": "Контрольная точка (пример)",
              },
              "completed": true,
              "lessons": [
                {
                  "completed": true,
                  "id": "m01-1",
                  "installed": true,
                  "kind": "lesson",
                  "tally": {
                    "done": 5,
                    "total": 5,
                  },
                  "title": "Знакомство и είμαι",
                },
                {
                  "completed": true,
                  "id": "m01-test",
                  "installed": true,
                  "kind": "test",
                  "tally": {
                    "done": 2,
                    "total": 2,
                  },
                  "title": "Контрольная модуля 01",
                },
              ],
              "module": {
                "checkpointId": "m01-k1",
                "courseId": "greek-a2",
                "crib": {
                  "rows": [
                    [
                      "εγώ",
                      "είμαι",
                    ],
                    [
                      "εμείς",
                      "είμαστε",
                    ],
                    [
                      "εσύ",
                      "είσαι",
                    ],
                    [
                      "εσείς",
                      "είστε",
                    ],
                    [
                      "αυτός",
                      "είναι",
                    ],
                    [
                      "αυτοί",
                      "είναι",
                    ],
                  ],
                  "title": "είμαι — быть",
                },
                "goal": "Поздороваться, представиться и спросить имя",
                "grammar": [
                  "είμαι",
                  "вопросы πώς / πού",
                ],
                "id": "m01",
                "lessonIds": [
                  "m01-1",
                  "m01-test",
                ],
                "number": 1,
                "reviewIds": [
                  "m01-r1",
                ],
                "sessions": 3,
                "status": "published",
                "subtitle": "Знакомство (пример)",
                "title": "Γνωριμία",
              },
              "review": [
                {
                  "completed": false,
                  "id": "m01-r1",
                  "installed": true,
                  "kind": "lesson",
                  "tally": {
                    "done": 0,
                    "total": 2,
                  },
                  "title": "Слабый навык (пример)",
                },
              ],
            },
            {
              "completed": false,
              "lessons": [],
              "module": {
                "courseId": "greek-a2",
                "goal": "Сказать, откуда ты и на каких языках говоришь",
                "grammar": [
                  "род и артикли",
                  "настоящее время",
                ],
                "id": "m02",
                "lessonIds": [],
                "number": 2,
                "sessions": 3,
                "status": "draft",
                "subtitle": "Страны и языки",
                "title": "Χώρες και γλώσσες",
              },
              "review": [],
            },
          ],
          "week": {
            "cards": 4,
            "lessonDays": [
              "2026-09-29",
            ],
            "monday": "2026-09-28",
            "reviewDays": [
              "2026-09-28",
              "2026-09-30",
              "2026-10-01",
              "2026-10-04",
            ],
            "today": "2026-10-04",
          },
        },
        "dictionary": [
          {
            "entries": [
              {
                "greek": "γεια",
                "key": "["word","geia"]",
                "mark": "solid",
                "russian": "привет; пока",
              },
              {
                "greek": "καλημέρα",
                "key": "["word","kalimera"]",
                "mark": "learning",
                "russian": "доброе утро, добрый день",
              },
              {
                "greek": "είμαι",
                "key": "["word","eimai"]",
                "mark": "new",
                "russian": "быть",
              },
              {
                "greek": "Πώς σε λένε;",
                "key": "["phrase","pos-se-lene"]",
                "mark": "new",
                "russian": "Как тебя зовут?",
              },
            ],
            "id": "m01-1",
            "moduleId": "m01",
            "moduleNumber": 1,
            "moduleTitle": "Γνωριμία",
            "number": "1.1",
            "title": "Знакомство и είμαι",
          },
          {
            "entries": [],
            "id": "m01-test",
            "moduleId": "m01",
            "moduleNumber": 1,
            "moduleTitle": "Γνωριμία",
            "number": "1.2",
            "title": "Контрольная модуля 01",
          },
          {
            "entries": [],
            "id": "m01-k1",
            "moduleId": "m01",
            "moduleNumber": 1,
            "moduleTitle": "Γνωριμία",
            "number": null,
            "title": "Контрольная точка (пример)",
          },
          {
            "entries": [],
            "id": "m01-r1",
            "moduleId": "m01",
            "moduleNumber": 1,
            "moduleTitle": "Γνωριμία",
            "number": null,
            "title": "Слабый навык (пример)",
          },
        ],
        "plan": {
          "newRefs": [
            {
              "id": "eimai",
              "kind": "word",
            },
            {
              "id": "pos-se-lene",
              "kind": "phrase",
            },
          ],
          "origins": [
            [
              "["word","eimai"]",
              {
                "lessonId": "m01-1",
                "title": "Знакомство и είμαι",
              },
            ],
            [
              "["phrase","pos-se-lene"]",
              {
                "lessonId": "m01-1",
                "title": "Знакомство и είμαι",
              },
            ],
          ],
          "reviews": [
            "["word","kalimera"]",
            "["word","geia"]",
          ],
          "today": "2026-10-04",
          "unavailable": [],
        },
        "stats": {
          "days": [
            {
              "answers": 1,
              "cards": 1,
              "date": "2026-09-28",
            },
            {
              "answers": 0,
              "cards": 0,
              "date": "2026-09-29",
            },
            {
              "answers": 1,
              "cards": 1,
              "date": "2026-09-30",
            },
            {
              "answers": 1,
              "cards": 1,
              "date": "2026-10-01",
            },
            {
              "answers": 0,
              "cards": 0,
              "date": "2026-10-02",
            },
            {
              "answers": 1,
              "cards": 1,
              "date": "2026-10-03",
            },
            {
              "answers": 1,
              "cards": 1,
              "date": "2026-10-04",
            },
          ],
          "due": {
            "today": 2,
            "tomorrow": 2,
            "week": 2,
          },
          "groups": {
            "fresh": 2,
            "learning": 1,
            "review": 0,
            "solid": 1,
          },
          "leeches": [],
          "skills": [
            {
              "attempts": 2,
              "correct": 2,
              "rate": 1,
              "type": "recognition",
            },
            {
              "attempts": 1,
              "correct": 1,
              "rate": 1,
              "type": "assembly",
            },
            {
              "attempts": 1,
              "correct": 0,
              "rate": 0,
              "type": "spelling",
            },
            {
              "attempts": 0,
              "correct": 0,
              "rate": null,
              "type": "listening",
            },
            {
              "attempts": 0,
              "correct": 0,
              "rate": null,
              "type": "comprehension",
            },
          ],
          "totals": {
            "answers": 6,
            "byKind": {
              "phrase": 0,
              "word": 3,
            },
            "cards": 3,
          },
        },
      }
    `);
  });

  it("удалённое слово уходит со своим состоянием, навыками и местом в уроке; история остаётся", async () => {
    const apo = '["word","apo"]';
    expect(await db.words.get("apo")).toBeUndefined();
    expect(await db.cardStates.get(apo)).toBeUndefined();
    expect(await db.cardSkills.get(apo)).toBeUndefined();
    expect(await db.lessonItems.where("unitKey").equals(apo).count()).toBe(0);
    expect(await db.events.count()).toBe(6);
    expect(await db.cardStates.count()).toBe(2);
  });

  it("курс, уроки, карточки, пакеты и занятия теряют поля Tavelori", async () => {
    expect(await db.courses.toArray()).toEqual([
      {
        id: "greek-a2",
        title: "Греческий A2 (пример)",
        exam: expect.objectContaining({ date: "2027-05-11" }),
        updatedAt: "2026-09-10T08:00:00.000Z",
      },
    ]);
    expect(await db.lessons.get("m01-1")).toEqual({
      id: "m01-1",
      courseId: "greek-a2",
      title: "Знакомство и είμαι",
      completed: true,
      updatedAt: "2026-09-21T15:00:00.000Z",
    });
    expect((await db.lessons.get("m01-k1"))?.completed).toBe(false);
    expect(await db.words.get("kalimera")).not.toHaveProperty("edited");
    expect(await db.phrases.get("pos-se-lene")).not.toHaveProperty("provenance");
    for (const pack of await db.packages.toArray()) expect(pack).not.toHaveProperty("removed");
    expect((await db.sessions.get("s-recall"))?.status).toBe("ended");
    expect((await db.sessions.get("s-old"))?.status).toBe("done");
  });

  it("пустые хранилища и индексы Tavelori удалены", async () => {
    const names = db.tables.map((table) => table.name);
    for (const gone of ["lessonWords", "states", "baseSkills", "syncStash", "clozes"])
      expect(names).not.toContain(gone);
    const indexes = (name: string) => db.table(name).schema.indexes.map((index) => index.name);
    expect(indexes("words")).not.toContain("deletedAt");
    expect(indexes("phrases")).not.toContain("deletedAt");
    expect(indexes("lessons")).toEqual(["courseId"]);
    expect(indexes("courses")).toEqual([]);
  });
});

describe("копия данных v8", () => {
  it("восстанавливается через ту же миграцию с тем же планом, словарём и статистикой", async () => {
    const expected = await views(db);
    const file = await backupV8();
    const target = new AppDatabase("tetradio-v8-restore");
    await target.open();
    try {
      const check = await inspectBackup(file, target);
      expect(check.ok && check.report.legacy).toBe(true);
      await restoreBackup(file, target);
      // Каталог и модули — кеш, в копию не входят: их приносит обновление каталога.
      await target.catalog.bulkPut(await db.catalog.toArray());
      await target.modules.bulkPut(await db.modules.toArray());
      expect(await views(target)).toEqual(expected);
      expect(await target.courses.get("my")).toBeUndefined();
      expect(await target.words.get("apo")).toBeUndefined();
    } finally {
      target.close();
      await Dexie.delete("tetradio-v8-restore");
    }
  });

  it("копия старше v8 отклоняется", async () => {
    const file = await backupV8();
    const text = (await file.text()).replace('"databaseVersion":8', '"databaseVersion":7');
    expect(text).toContain('"databaseVersion":7');
    const check = await inspectBackup(new Blob([text]), db);
    expect(check).toEqual({ ok: false, message: expect.stringMatching(/слишком старой версией/) });
  });
});
