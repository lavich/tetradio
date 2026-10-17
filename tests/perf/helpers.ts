import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { type Page } from "@playwright/test";

/** Пакетов в IndexedDB мок-сборки: установка курса закончена, когда их столько же, сколько уроков в каталоге. */
export const installed = (page: Page) =>
  page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("tetradio-mock-1");
      request.onsuccess = () => resolve(request.result);
    });
    const count = await new Promise<number>((resolve) => {
      const request = database.transaction("packages").objectStore("packages").count();
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return count;
  });

export const lessonCount = (page: Page, course: string) =>
  page.evaluate(async (id) => {
    const catalog = (await (await fetch("/content/catalog.json")).json()) as {
      courses: { id: string; lessonIds: string[] }[];
    };
    return catalog.courses.find((item) => item.id === id)!.lessonIds.length;
  }, course);

/** Итог замера: JSON в `test-results/perf` (артефакт CI) и таблица в сводку задачи. */
export function publish(name: string, title: string, rows: Record<string, number | string>[]) {
  mkdirSync("test-results/perf", { recursive: true });
  writeFileSync(`test-results/perf/${name}.json`, JSON.stringify(rows, null, 2));
  if (!process.env.GITHUB_STEP_SUMMARY || !rows.length) return;
  const columns = Object.keys(rows[0]!);
  const table = [
    `| ${columns.join(" | ")} |`,
    `|${columns.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${columns.map((column) => row[column]).join(" | ")} |`),
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${title}\n\n${table.join("\n")}\n`);
}
