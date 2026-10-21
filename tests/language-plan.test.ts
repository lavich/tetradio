import { describe, expect, it } from "vitest";
import { State } from "ts-fsrs";
import { makeLanguagePlan, makePlan } from "../src/domain/learning";
import { fromSnapshot } from "./helpers/snapshot-source";
import { languageSnapshot, NOW, phraseOf, reviewOf, wordKey } from "./helpers/language-fixture";

const ids = (refs: { id: string }[]) => refs.map((ref) => ref.id);
const reviewIds = (plan: { reviews: { ref: { id: string } }[] }) => ids(plan.reviews.map((review) => review.ref));
const due = (count: number, at: string) => (words: Parameters<typeof wordKey>[0][]) =>
  words.slice(0, count).map((word) => reviewOf(wordKey(word), at));
const english = { courseIds: ["it", "travel"] };
const resumed = { pausedAt: null, resumedAt: "2026-09-15T08:00:00Z" };

describe("план языка — слияние планов его курсов", () => {
  it("повторения обоих курсов — в общем порядке по сроку, без чередования курсов", async () => {
    const data = languageSnapshot({
      it: { words: 15, states: due(15, "2026-09-13T09:00:00Z") },
      travel: { words: 15, states: due(15, "2026-09-14T09:00:00Z") },
      greek: { words: 3, states: due(3, "2026-09-12T09:00:00Z") },
    });
    const plan = await makeLanguagePlan(fromSnapshot(data), NOW, english);
    const order = reviewIds(plan);
    expect(order).toHaveLength(30);
    expect(order.slice(0, 15).every((id) => id.startsWith("i"))).toBe(true);
    expect(order.slice(15).every((id) => id.startsWith("t"))).toBe(true);
    expect(plan.newRefs).toEqual([]);
  });
  it("переучиваемые и разучиваемые обоих курсов — раньше остальных повторений", async () => {
    const data = languageSnapshot({
      it: {
        words: 2,
        states: (words) => [
          reviewOf(wordKey(words[0]), "2026-09-10T09:00:00Z"),
          reviewOf(wordKey(words[1]), "2026-09-15T08:30:00Z", { state: State.Learning }),
        ],
      },
      travel: {
        words: 2,
        states: (words) => [
          reviewOf(wordKey(words[0]), "2026-09-15T08:00:00Z", { state: State.Relearning }),
          reviewOf(wordKey(words[1]), "2026-09-11T09:00:00Z"),
        ],
      },
    });
    const plan = await makeLanguagePlan(fromSnapshot(data), NOW, english);
    expect(reviewIds(plan)).toEqual(["t0", "i1", "i0", "t1"]);
  });
  it("новые — по очереди курсов с первого в списке; у курса без новых очередь идёт дальше", async () => {
    const data = languageSnapshot({ it: { words: 12 }, travel: { words: 3 }, greek: { words: 4 } });
    const plan = await makeLanguagePlan(fromSnapshot(data), NOW, english);
    expect(ids(plan.newRefs)).toEqual([
      "i0",
      "t0",
      "i1",
      "t1",
      "i2",
      "t2",
      "i3",
      "i4",
      "i5",
      "i6",
      "i7",
      "i8",
      "i9",
      "i10",
      "i11",
    ]);
    const reversed = await makeLanguagePlan(fromSnapshot(data), NOW, { courseIds: ["travel", "it"] });
    expect(ids(reversed.newRefs).slice(0, 4)).toEqual(["t0", "i0", "t1", "i1"]);
  });
  it("долг паузы одного курса — после переучиваемых обоих курсов и перед остальными повторениями, по забытости", async () => {
    const data = languageSnapshot(
      {
        it: {
          words: 3,
          states: (words) => [
            reviewOf(wordKey(words[0]), "2026-09-02T09:00:00Z", { lastReview: "2026-08-20T09:00:00Z", stability: 100 }),
            reviewOf(wordKey(words[1]), "2026-09-10T09:00:00Z", { lastReview: "2026-09-08T09:00:00Z", stability: 2 }),
            reviewOf(wordKey(words[2]), "2026-09-15T08:30:00Z", { state: State.Relearning }),
          ],
        },
        travel: {
          words: 3,
          states: (words) => [
            reviewOf(wordKey(words[0]), "2026-09-01T09:00:00Z"),
            reviewOf(wordKey(words[1]), "2026-09-15T08:00:00Z", { state: State.Relearning }),
          ],
        },
      },
      { it: resumed },
    );
    const plan = await makeLanguagePlan(fromSnapshot(data), NOW, english);
    expect(reviewIds(plan)).toEqual(["t1", "i2", "i1", "i0", "t0"]);
    expect(plan.pauseDebt).toBe(2);
    expect(plan.newRefs.map((ref) => ref.id)).toEqual(["t2"]);
  });
  it("долг паузы двух курсов — сумма, общий порядок по забытости", async () => {
    const data = languageSnapshot(
      {
        it: {
          words: 1,
          states: (words) => [
            reviewOf(wordKey(words[0]), "2026-09-02T09:00:00Z", { lastReview: "2026-08-20T09:00:00Z", stability: 100 }),
          ],
        },
        travel: {
          words: 1,
          states: (words) => [
            reviewOf(wordKey(words[0]), "2026-09-10T09:00:00Z", { lastReview: "2026-09-08T09:00:00Z", stability: 2 }),
          ],
        },
      },
      { it: resumed, travel: resumed },
    );
    const plan = await makeLanguagePlan(fromSnapshot(data), NOW, english);
    expect(reviewIds(plan)).toEqual(["t0", "i0"]);
    expect(plan.pauseDebt).toBe(2);
  });
  it("курс на паузе в списке — ни одной его карточки, план другого курса прежний", async () => {
    const data = languageSnapshot(
      {
        it: { words: 4, states: due(2, "2026-09-14T09:00:00Z") },
        travel: { words: 4, states: due(2, "2026-09-13T09:00:00Z") },
      },
      { travel: { pausedAt: "2026-09-14T09:00:00Z", resumedAt: null } },
    );
    const plan = await makeLanguagePlan(fromSnapshot(data), NOW, english);
    expect(plan).toEqual(await makePlan(fromSnapshot(data), NOW, { courseId: "it" }));
    expect([...ids(plan.newRefs), ...reviewIds(plan)].some((id) => id.startsWith("t"))).toBe(false);
  });
  it("недоступные — обоих курсов, пробуждение — ближайшее, источники новых — объединение", async () => {
    const data = languageSnapshot({
      it: { words: 2, phrases: [phraseOf("it", 0, false)] },
      travel: {
        words: 2,
        phrases: [phraseOf("travel", 0, false)],
        states: (words) => [reviewOf(wordKey(words[1]), "2026-09-15T10:00:00Z", { state: State.Learning })],
      },
    });
    const source = fromSnapshot(data);
    const plan = await makeLanguagePlan(source, NOW, english);
    expect(plan.unavailable.map((ref) => ref.id)).toEqual(["ip0", "tp0"]);
    expect(plan.wakeAt).toEqual(new Date("2026-09-15T10:00:00Z"));
    const travel = await makePlan(source, NOW, { courseId: "travel" });
    const it = await makePlan(source, NOW, { courseId: "it" });
    expect(it.wakeAt.getTime()).toBeGreaterThan(plan.wakeAt.getTime());
    expect(plan.wakeAt).toEqual(travel.wakeAt);
    expect(plan.origins).toEqual(new Map([...it.origins, ...travel.origins]));
    expect(plan.today).toBe(it.today);
  });
  it("карточек другого языка нет", async () => {
    const data = languageSnapshot({
      it: { words: 2, states: due(1, "2026-09-14T09:00:00Z") },
      travel: { words: 2 },
      greek: { words: 5, states: due(3, "2026-09-14T09:00:00Z") },
    });
    const plan = await makeLanguagePlan(fromSnapshot(data), NOW, english);
    expect([...ids(plan.newRefs), ...reviewIds(plan)].some((id) => id.startsWith("g"))).toBe(false);
  });
  it("страж: один курс в списке — тот же план, что у курса; без паузы поля долга у повторений нет", async () => {
    const plain = languageSnapshot({
      it: { words: 6, phrases: [phraseOf("it", 0), phraseOf("it", 1, false)], states: due(3, "2026-09-14T09:00:00Z") },
      travel: { words: 3, states: due(2, "2026-09-14T09:00:00Z") },
    });
    const withDebt = { ...plain, pauses: { it: resumed } };
    for (const data of [plain, withDebt]) {
      const source = fromSnapshot(data);
      const plan = await makeLanguagePlan(source, NOW, { courseIds: ["it"], hasVoice: true });
      expect(plan).toEqual(await makePlan(source, NOW, { courseId: "it", hasVoice: true }));
    }
    const plan = await makeLanguagePlan(fromSnapshot(plain), NOW, { courseIds: ["it"] });
    expect(plan.reviews.every((review) => !("debt" in review))).toBe(true);
  });
});
