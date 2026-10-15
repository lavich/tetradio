import { expect, test } from "../playwright-test";
import { type Page } from "@playwright/test";
import { firstWords, installLessons, putRecords } from "./helpers";

test.use({ timezoneId: "Asia/Nicosia" });

/** Ответ занятия по плану: учебный день записан так, как его пишет приложение. */
async function seedAnswer(page: Page, createdAt: string, localDate: string) {
  const [word] = await firstWords(page, 1);
  await putRecords(page, {
    events: [
      {
        id: `e-${createdAt}`,
        sessionId: "evening",
        itemId: `i-${createdAt}`,
        ref: { kind: "word", id: word.id },
        unitKey: JSON.stringify(["word", word.id]),
        snapshot: { greek: word.greek, russian: word.russian },
        type: "recognition",
        mode: "scheduled",
        rating: 3,
        correct: true,
        answer: word.russian,
        createdAt,
        localDate,
        responseTimeMs: 1000,
      },
    ],
  });
}

test("«Сегодня» после полуночи — вчерашний учебный день, в 04:00 день сменяется", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-16T00:30:00+03:00") });
  await installLessons(page, ["mech-1"]);
  await seedAnswer(page, "2026-10-15T21:10:00.000Z", "2026-10-15");
  await page.reload();
  await expect(page.locator("p[lang=el]").first()).toHaveText("Πέμπτη, 15 Οκτωβρίου");
  await expect(page.getByTestId("day-done")).toHaveText("1 карточка сегодня");
  await page.clock.fastForward("03:31:00");
  await expect(page.locator("p[lang=el]").first()).toHaveText("Παρασκευή, 16 Οκτωβρίου");
  await expect(page.getByRole("img", { name: "повторение сделано" })).toHaveCount(0);
});

test("неделя на «Прогрессе» сменяется в понедельник в 04:00, а не в полночь", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-18T23:50:00+03:00") });
  await installLessons(page, ["mech-1"]);
  await seedAnswer(page, "2026-10-18T21:20:00.000Z", "2026-10-18");
  await page.goto("/app/progress");
  await expect(page.getByTestId("week")).toHaveText("На этой неделе: повторение 1 день.");
  await page.clock.fastForward("00:20:00");
  await expect(page.getByTestId("week")).toHaveText("На этой неделе: повторение 1 день.");
  await page.clock.fastForward("03:52:00");
  await expect(page.getByTestId("week")).toHaveText("На этой неделе занятий ещё не было.");
});
