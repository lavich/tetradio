// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { LanguageSwitch } from "../src/shared/CourseSwitch";
import { db, type StoredCatalogEntry } from "../src/storage/db";
import { currentLanguage, rememberCourses, shelfLanguage } from "../src/storage/courses";

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
const start = async (courseId: string) => {
  await db.lessons.add({ id: `${courseId}-1`, courseId, title: courseId, completed: false, updatedAt: iso });
  await rememberCourses(db);
};

let root: Root | null = null;
let host: HTMLElement;
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.courses.bulkAdd([
    { id: "greek-a2", title: "Греческий", short: "Греческий", order: 1, updatedAt: iso },
    { id: "english-it", title: "Английский для IT", short: "Для IT", language: "en", order: 2, updatedAt: iso },
    {
      id: "english-travel",
      title: "Английский для путешествий и общения",
      short: "Для путешествий",
      language: "en",
      palette: "coast",
      order: 3,
      updatedAt: iso,
    },
  ]);
  await db.catalog.bulkAdd([
    entry("greek-a2-1", "greek-a2", "el", 0),
    entry("english-it-1", "english-it", "en", 1),
    entry("english-travel-1", "english-travel", "en", 2),
  ]);
  await start("greek-a2");
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});
const mount = async (shelf: boolean) => {
  root ??= createRoot(host);
  root!.render(<LanguageSwitch shelf={shelf} />);
};
const settled = (check: () => void) => vi.waitFor(check, 5000);
const radios = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const group = () => host.querySelector('[role="radiogroup"]');

describe("переключатель языка", () => {
  it("на «Курсе» — языки, а не курсы: «Греческий» и «+ Английский» при трёх курсах", async () => {
    await mount(true);
    await settled(() => expect(radios().map((radio) => radio.textContent)).toEqual(["Греческий", "+ Английский"]));
    expect(group()?.getAttribute("aria-label")).toBe("Язык");
    expect(radios()[1].getAttribute("aria-label")).toBe("Английский, не начат");
    radios()[1].click();
    await settled(() => expect(radios()[1].getAttribute("aria-checked")).toBe("true"));
    expect(await shelfLanguage(db)).toBe("en");
    expect(await currentLanguage(db)).toBe("el");
  });
  it("на «Словах» языка без начатых курсов нет — переключателя нет", async () => {
    await mount(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(group()).toBeNull();
  });
  it("два начатых языка на «Словах» — «Греческий» и «Английский», выбор меняет язык", async () => {
    await start("english-it");
    await start("english-travel");
    await mount(false);
    await settled(() => expect(radios().map((radio) => radio.textContent)).toEqual(["Греческий", "Английский"]));
    radios()[1].click();
    await settled(() => expect(radios()[1].getAttribute("aria-checked")).toBe("true"));
    expect(await currentLanguage(db)).toBe("en");
  });
  it("один язык в каталоге и на устройстве — переключателя нет", async () => {
    await db.catalog.where("courseId").anyOf("english-it", "english-travel").delete();
    await mount(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(group()).toBeNull();
  });
});
