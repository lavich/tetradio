import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPackage } from "../src/content/apply";
import { parsePackage, type ContentPackage } from "../src/content/schema";
import { startSession } from "../src/features/learning/session-actions";
import { AppDatabase } from "../src/storage/db";
import { courseCardIds, courseLessonIds, lessonItemsOf } from "../src/storage/courses";
import { recordAnswer } from "../src/storage/ops";
import { optionPool, phrasePool } from "../src/storage/queries";
import type { CardKind, Session, SessionItem } from "../src/domain/types";
import { realContent } from "./helpers/real-content";

const COURSE = "greek-a2";
const OTHER = "english-it";
let db: AppDatabase;
const install = (pack: ContentPackage) => applyPackage(parsePackage(JSON.parse(JSON.stringify(pack))), db);
const installRaw = (pack: ContentPackage) => applyPackage(pack, db);

beforeAll(async () => {
  await new AppDatabase("tetradio-wrong-answer").delete();
  db = new AppDatabase("tetradio-wrong-answer");
  await db.open();
  for (const pack of realContent().packages) await install(pack);
});
afterAll(() => db.close());

async function wrongAnswer(kind: CardKind, type: SessionItem["type"]) {
  const refs = (await courseCardIds(COURSE, kind, db)).slice(0, 5).map((id) => ({ kind, id }));
  const session = (await startSession(new Date(), { refs, mode: "practice", courseId: COURSE }, db)) as Session;
  const item = { ...session.items[0], type };
  const start = performance.now();
  await recordAnswer({
    session,
    item,
    correct: false,
    answer: "λάθος",
    responseTimeMs: 1000,
    activeTimeMs: 1000,
    timezone: "UTC",
    database: db,
  });
  const ms = performance.now() - start;
  const saved = (await db.sessions.get(session.id))!;
  return { ms, retry: saved.items.find((entry) => entry.retryOf === item.id) };
}

describe("неверный ответ на настоящем курсе", () => {
  it("связи уроков те же по составу и порядку, что у прежнего anyOf, и читаются в разы быстрее", async () => {
    const lessonIds = await courseLessonIds(COURSE, db);
    expect(lessonIds.length).toBeGreaterThan(50);
    const asked = [...lessonIds].reverse();
    let start = performance.now();
    const fast = await lessonItemsOf(asked, db);
    const fastMs = performance.now() - start;
    start = performance.now();
    const old = await db.lessonItems.where("lessonId").anyOf(asked).toArray();
    const oldMs = performance.now() - start;
    expect(fast).toEqual(old);
    expect(fastMs * 5).toBeLessThan(oldMs);
  }, 30_000);

  it.each([
    ["word", "assembly", /^recognition$/],
    ["word", "spelling", /^(assembly|recognition)$/],
    ["phrase", "spelling", /^recognition$/],
  ] as const)(
    "%s/%s: дополнительная попытка строится быстро",
    async (kind, type, easier) => {
      const { ms, retry } = await wrongAnswer(kind, type);
      expect(retry?.type).toMatch(easier);
      expect(ms).toBeLessThan(500);
    },
    30_000,
  );

  it("пул вариантов — карточки курса, до 48, без повторов; чужого курса нет", async () => {
    const own = {
      word: new Set(await courseCardIds(COURSE, "word", db)),
      phrase: new Set(await courseCardIds(COURSE, "phrase", db)),
    };
    const other = new Set([...(await courseCardIds(OTHER, "word", db)), ...(await courseCardIds(OTHER, "phrase", db))]);
    expect(other.size).toBeGreaterThan(0);
    for (const [kind, ids] of [
      ["word", (await optionPool(48, COURSE, db)).map((word) => word.id)],
      ["phrase", (await phrasePool(48, COURSE, db)).map((phrase) => phrase.id)],
    ] as const) {
      expect(ids).toHaveLength(48);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => own[kind].has(id))).toBe(true);
      expect(ids.some((id) => other.has(id))).toBe(false);
    }
  });

  it("обновление урока сразу меняет состав: снятая с урока карточка выпадает из курса", async () => {
    const packs = realContent().packages.filter((pack) => pack.courseId === COURSE);
    const inLessons = new Map<string, number>();
    for (const pack of packs)
      for (const item of pack.items)
        inLessons.set(`${item.kind}:${item.id}`, (inLessons.get(`${item.kind}:${item.id}`) ?? 0) + 1);
    const pack = packs.find((entry) =>
      entry.items.some((item) => item.kind === "word" && inLessons.get(`word:${item.id}`) === 1),
    )!;
    const dropped = pack.items.find((item) => item.kind === "word" && inLessons.get(`word:${item.id}`) === 1)!;
    expect(await courseCardIds(COURSE, "word", db)).toContain(dropped.id);
    try {
      await installRaw({
        ...pack,
        version: `${pack.version}-next`,
        items: pack.items.filter((item) => item !== dropped),
      });
      expect(await courseCardIds(COURSE, "word", db)).not.toContain(dropped.id);
    } finally {
      await installRaw(pack);
    }
    expect(await courseCardIds(COURSE, "word", db)).toContain(dropped.id);
  });
});
