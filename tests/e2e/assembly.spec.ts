import { expect, test } from "@playwright/test";
import { installLessons } from "./helpers";

/** Слово со сроком и пройденными recall/recognition получает сборку следующим навыком. */
const dueWithHistory = (page: import("@playwright/test").Page, wordId: string, types: string[]) =>
  page.evaluate(
    async ({ wordId, types }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("lexi");
        request.onsuccess = () => resolve(request.result);
      });
      const due = new Date(Date.now() - 2 * 86400000);
      const tx = db.transaction(["cardStates", "events", "settings", "courses"], "readwrite");
      const key = JSON.stringify(["word", wordId]);
      tx.objectStore("settings").put({ id: "settings", timezone: "Asia/Nicosia", sessionSize: 20 });
      // Новых слов в занятии нет: предел принадлежит курсу, поэтому обнуляется у каждого.
      const courses = tx.objectStore("courses");
      const all = courses.getAll();
      all.onsuccess = () => {
        for (const course of all.result as { newItemsPerDay: number }[]) courses.put({ ...course, newItemsPerDay: 0 });
      };
      tx.objectStore("cardStates").put({
        unitKey: key,
        ref: { kind: "word", id: wordId },
        version: 1,
        introducedAt: new Date(Date.now() - 9 * 86400000).toISOString(),
        card: {
          due,
          stability: 2.5,
          difficulty: 5,
          elapsed_days: 2,
          scheduled_days: 2,
          reps: 3,
          lapses: 0,
          state: 2,
          learning_steps: 0,
          last_review: new Date(Date.now() - 4 * 86400000),
        },
      });
      types.forEach((type, index) => {
        const at = new Date(Date.now() - (9 - index) * 86400000).toISOString();
        tx.objectStore("events").put({
          id: `seed-${type}-${index}`,
          sessionId: "seed",
          itemId: `seed-${type}-${index}`,
          ref: { kind: "word", id: wordId },
          unitKey: key,
          snapshot: { greek: "", russian: "" },
          type,
          mode: "scheduled",
          rating: 3,
          correct: true,
          answer: "",
          createdAt: at,
          localDate: at.slice(0, 10),
          responseTimeMs: 900,
        });
      });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    },
    { wordId, types },
  );

async function openAssembly(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /Начать занятие/ }).click();
  await page.waitForURL("**/session");
  for (let step = 0; step < 12; step++) {
    await page.waitForTimeout(120);
    const prompt = await page
      .getByTestId("prompt")
      .first()
      .innerText()
      .catch(() => "");
    if (prompt === "Собери слово") return;
    const next = page.getByRole("button", { name: "Далее" });
    if (await next.isVisible().catch(() => false)) {
      await next.click({ timeout: 5000 }).catch(() => undefined);
      continue;
    }
    const option = page.getByTestId("option").and(page.locator(":not([disabled])")).first();
    if (await option.isVisible().catch(() => false)) {
      await option.click();
      continue;
    }
    const input = page.getByLabel("Твой ответ по-гречески");
    if (await input.isVisible().catch(() => false)) {
      await input.fill("λάθος");
      await page.getByRole("button", { name: "Проверить" }).click();
      continue;
    }
  }
  throw new Error("Сборка не выпала за отведённые шаги");
}

const updateWord = (page: import("@playwright/test").Page, greek: string, russian: string) =>
  page.evaluate(
    ({ greek, russian }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("lexi");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("words", "readwrite");
          const store = tx.objectStore("words");
          const get = store.get("w12-16");
          get.onsuccess = () => store.put({ ...get.result, greek, russian });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
    { greek, russian },
  );

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("[data-testid=today-title]");
  await installLessons(page, ["lesson-1-2"]);
  await dueWithHistory(page, "w12-16", ["recall", "recognition"]);
  await page.reload();
  await page.waitForSelector("[data-testid=today-title]");
});

test("артикль ставит пользователь, а неверный порядок даёт понятную обратную связь", async ({ page }) => {
  await openAssembly(page);
  await expect(page.getByTestId("article-hint")).toHaveCount(0);
  await expect(page.getByTestId("fixed-article")).toHaveCount(0);
  expect((await page.getByTestId("tile").allInnerTexts()).sort()).toEqual(["σπί", "τι", "το"].sort());
  await expect(page.getByRole("button", { name: "Проверить" })).toBeDisabled();

  await page.getByTestId("tile").filter({ hasText: /^τι$/ }).click();
  await page.getByTestId("tile").filter({ hasText: /^σπί$/ }).click();
  await expect(page.getByRole("button", { name: "Проверить" })).toBeDisabled(); // артикль тоже входит в пул
  await page.getByTestId("tile").filter({ hasText: /^το$/ }).click();
  await expect(page.getByRole("button", { name: "Проверить" })).toBeEnabled();
  await page.getByTestId("placed").filter({ hasText: /^το$/ }).click();
  await expect(page.getByRole("button", { name: "Проверить" })).toBeDisabled();
  await page.getByTestId("tile").filter({ hasText: /^το$/ }).click();
  await page.getByRole("button", { name: "Проверить" }).click();
  await expect(page.getByTestId("feedback")).toContainText("Пока не сходится");
  await expect(page.getByTestId("feedback")).toContainText("το · σπί-τι");
  await expect(page.getByTestId("tile")).toHaveCount(0); // после ответа плитки убираются
});

test("верные слоги с артиклем не на месте дают «Почти»", async ({ page }) => {
  await openAssembly(page);
  for (const tile of ["σπί", "τι", "το"])
    await page
      .getByTestId("tile")
      .filter({ hasText: new RegExp(`^${tile}$`) })
      .click();
  await page.getByRole("button", { name: "Проверить" }).click();
  await expect(page.getByTestId("feedback")).toContainText("Почти! Проверь артикль.");
  await expect(page.getByTestId("feedback")).toContainText("το · σπί-τι");
});

test("верный порядок засчитывается и остаётся в истории", async ({ page }) => {
  await updateWord(page, "η οικογένεια", "семья");
  await page.reload();
  await openAssembly(page);
  for (const tile of ["η", "οι", "κο", "γέ", "νεια"])
    await page
      .getByTestId("tile")
      .filter({ hasText: new RegExp(`^${tile}$`) })
      .click();
  await page.getByRole("button", { name: "Проверить" }).click();
  await expect(page.getByTestId("feedback")).toContainText("Правильно!");
  await expect(page.getByTestId("feedback")).toContainText("η · οι-κο-γέ-νεια");
  const events = await page.evaluate(
    () =>
      new Promise<{ type: string; correct: boolean; answer: string }[]>((resolve) => {
        const request = indexedDB.open("lexi");
        request.onsuccess = () => {
          const rows = request.result.transaction("events", "readonly").objectStore("events").getAll();
          rows.onsuccess = () =>
            resolve(rows.result.filter((event: { sessionId: string }) => event.sessionId !== "seed"));
        };
      }),
  );
  const assembly = events.find((event) => event.type === "assembly")!;
  expect(assembly.correct).toBe(true);
  expect(assembly.answer).toBe("η οικογένεια");
});

test("старая сессия без артикля в вариантах доигрывается по новым правилам", async ({ page }) => {
  await openAssembly(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("lexi");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("sessions", "readwrite");
          const store = tx.objectStore("sessions");
          const all = store.getAll();
          all.onsuccess = () => {
            const session = all.result.find((entry: { status: string }) => entry.status === "active");
            const item = session.items[session.index] as { id: string; options: string[] };
            // Сессия, собранная до изменения: артикль из пула убран и выкладывался отдельно.
            const at = item.options.indexOf("το");
            const without = item.options.filter((_: string, index: number) => index !== at);
            store.put({
              ...session,
              items: session.items.map((entry: { id: string }) =>
                entry.id === item.id ? { ...entry, options: without } : entry,
              ),
            });
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await page.reload();
  // Ждём сами плитки: проверка на отсутствие артикля проходит и на ещё пустой странице,
  // поэтому гонкой она не управляет, а allInnerTexts читает разово и вернул бы [].
  await expect(page.getByTestId("tile")).toHaveCount(3);
  await expect(page.getByTestId("fixed-article")).toHaveCount(0);
  expect((await page.getByTestId("tile").allInnerTexts()).sort()).toEqual(["σπί", "τι", "το"].sort());
  for (const tile of ["το", "σπί", "τι"])
    await page
      .getByTestId("tile")
      .filter({ hasText: new RegExp(`^${tile}$`) })
      .click();
  await page.getByRole("button", { name: "Проверить" }).click();
  await expect(page.getByTestId("feedback")).toContainText("Правильно!");
});

test("слово без артикля собирается из своих слогов", async ({ page }) => {
  await updateWord(page, "διαβάζω", "читать");
  await page.reload();
  await openAssembly(page);
  await expect(page.getByTestId("fixed-article")).toHaveCount(0);
  await expect(page.getByTestId("article-hint")).toHaveCount(0);
  for (const tile of ["δια", "βά", "ζω"])
    await page
      .getByTestId("tile")
      .filter({ hasText: new RegExp(`^${tile}$`) })
      .click();
  await page.getByRole("button", { name: "Проверить" }).click();
  await expect(page.getByTestId("feedback")).toContainText("δια-βά-ζω");
});
