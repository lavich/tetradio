// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { createEmptyCard } from "ts-fsrs";
import { App } from "../src/app/App";
import { setCatalogPhase } from "../src/content/phases";
import { unitKey, wordRef } from "../src/domain/refs";
import { indexWord, db, type StoredCatalogEntry } from "../src/storage/db";
import { PRIMARY_COURSE_KEY, rememberCourses, SHELF_COURSE_KEY, CURRENT_LANGUAGE_KEY } from "../src/storage/courses";
import { wordOf } from "./helpers/language-db";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

const iso = "2026-10-20T09:00:00.000Z";
const entry = (id: string, courseId: string, language: string, position: number): StoredCatalogEntry => ({
  id,
  courseId,
  language,
  title: id,
  wordCount: 0,
  phraseCount: 0,
  cardCount: 0,
  version: "1",
  url: "",
  bytes: 0,
  media: { count: 0, bytes: 0 },
  position,
});

let root: Root | null = null;
let host: HTMLElement;
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.courses.bulkAdd([
    { id: "greek-a2", title: "Греческий", short: "Греческий", order: 1, updatedAt: iso },
    { id: "english-it", title: "Английский для IT", short: "Для IT", language: "en", order: 2, updatedAt: iso },
  ]);
  await db.lessons.bulkAdd([
    { id: "english-it-1", courseId: "english-it", title: "Дорога", completed: true, updatedAt: iso },
  ]);
  const word = indexWord({ ...wordOf("it", 0), id: "ew1", greek: "to commute", russian: "ездить на работу" });
  await db.words.add(word);
  const ref = wordRef(word.id);
  await db.lessonItems.add({ lessonId: "english-it-1", unitKey: unitKey(ref), ref, position: 0 });
  await db.cardStates.add({
    unitKey: unitKey(ref),
    ref,
    introducedAt: iso,
    version: 1,
    card: { ...createEmptyCard(new Date("2026-10-01")), due: new Date("2026-10-10") },
  });
  await db.meta.bulkPut([
    { key: PRIMARY_COURSE_KEY, value: "english-it" },
    { key: CURRENT_LANGUAGE_KEY, value: "en" },
    { key: SHELF_COURSE_KEY, value: JSON.stringify({ en: "english-it" }) },
  ]);
  await rememberCourses(db);
  await db.catalog.bulkAdd([entry("m01-1", "greek-a2", "el", 0)]);
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const open = async (path: string) => {
  root = createRoot(host);
  root.render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
};
const SCREENS: Record<string, string> = {
  "/": "Программа",
  "/course": "Учить курс",
  "/words": "Словарь",
  "/reading": "В этом курсе текстов нет",
  "/progress": "Путь по курсу",
  "/progress/settings": "Настройки и данные",
};
const text = () => host.textContent ?? "";

describe("приложение с каталогом греческого и прогрессом английского", () => {
  it.each(Object.keys(SCREENS))("%s открывается без английского и без переключателя языка", async (path) => {
    await open(path);
    expect(text()).toContain(SCREENS[path]);
    expect(text()).not.toMatch(/Английск|Для IT|commute/);
    expect(host.querySelector('[role="radiogroup"][aria-label="Язык"]')).toBeNull();
  });

  it("с пакетами только скрытого курса «Сегодня» предлагает выбрать курс", async () => {
    await db.packages.put({ lessonId: "english-it-1", version: "1" } as never);
    await open("/");
    expect(host.querySelector("[data-testid=course-intro]")).not.toBeNull();
  });

  it("ссылка на скрытый курс ведёт на «Сегодня»", async () => {
    setCatalogPhase("ready");
    await open("/share/course/english-it");
    expect(host.querySelector("[data-testid=course-intro]")).not.toBeNull();
    expect(text()).not.toMatch(/Для IT/);
  });

  it("ссылка на установленное слово скрытого курса не открывает страницу слова", async () => {
    await open("/share/word/ew1");
    expect(host.querySelector("[data-testid=course-intro]")).not.toBeNull();
    expect(text()).not.toMatch(/commute|ездить на работу/);
  });
});
