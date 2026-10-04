import "fake-indexeddb/auto";
import "./helpers/self";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { dictionary } from "../src/storage/dictionary";
import { courseProgress } from "../src/storage/progress";
import { makePlan } from "../src/domain/learning";
import { progress } from "../src/domain/stats";
import { seedV8, V8_NOW } from "./helpers/v8";

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

describe("обновление копии v8", () => {
  it("план, словарь, «Прогресс» и статистика совпадают с исходными", async () => {
    expect(await views(db)).toMatchInlineSnapshot(`
      {
        "course": {
          "current": 1,
          "pace": {
            "done": 2,
            "lagWeeks": 0,
            "next": {
              "checkpoint": {
                "afterModule": 8,
                "date": "2026-12-13",
                "label": "K1",
                "title": "Контрольная A1",
              },
              "perWeek": 0.5,
              "remaining": 5,
            },
            "planned": 0,
            "recentPerWeek": 0.5,
            "total": 7,
          },
          "readiness": [
            {
              "basis": "Контрольная модуля 01",
              "result": 1,
              "share": 0.2857142857142857,
              "skill": "reading",
              "source": "test",
            },
            {
              "basis": "1",
              "result": 0.25,
              "share": 0.07142857142857142,
              "skill": "writing",
              "source": "self",
            },
            {
              "basis": "1",
              "result": 0.3333333333333333,
              "share": 0.09523809523809523,
              "skill": "speaking",
              "source": "self",
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
                    "total": 1,
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
          "budget": 2,
          "introducedToday": 1,
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
});
