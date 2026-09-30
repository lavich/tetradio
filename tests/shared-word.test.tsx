// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SharedWordScreen } from "../src/features/words/SharedWordScreen";
import { refreshCatalog, resetCatalogPhase, resetPreviews, useFetcher } from "../src/content/client";
import { ContentError } from "../src/content/schema";
import { db } from "../src/storage/db";
import { content, installLessons, memoryFetcher } from "./helpers/content";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  resetCatalogPhase();
  resetPreviews();
  useFetcher(memoryFetcher());
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(path = "/share/word/w34-03") {
  root = createRoot(host);
  act(() =>
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/share/word/:id" element={<SharedWordScreen />} />
          <Route path="/words/:id" element={<p>экран слова</p>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}
const text = () => host.textContent ?? "";
const busy = () => !!host.querySelector("[aria-busy=true]");
async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw new Error(`не дождались: ${what}\n${text()}`);
}
const userTables = ["lessons", "words", "lessonItems", "packages", "courses", "media", "assets", "cardStates"] as const;
const counts = async () => Object.fromEntries(await Promise.all(userTables.map(async (t) => [t, await db[t].count()])));

describe("слово по ссылке", () => {
  it("установленное слово открывается обычным экраном", async () => {
    await installLessons(db, ["lesson-3-4"]);
    mount();
    await until(() => text().includes("экран слова"), "переход на экран слова");
  });

  it("без установки — карточка из пакета с некликабельной подписью урока, база не меняется", async () => {
    await refreshCatalog();
    const before = await counts();
    mount();
    await until(() => text().includes("η κατσαρόλα"), "карточка");
    expect(text()).toContain("кастрюля");
    const label = host.querySelector("[data-testid=shared-lesson]")!;
    expect(label.textContent).toMatch(/^Слово из урока 3\.4/);
    expect(host.querySelector("a[href^='/lessons']")).toBeNull();
    expect(text()).not.toContain("Потренировать");
    expect(host.querySelector("[aria-label='Редактировать слово']")).toBeNull();
    await act(async () => {
      (label as HTMLElement).click();
    });
    expect(await counts()).toEqual(before);
    expect(before.words).toBe(0);
  });

  it("удалённое слово показывается просмотром и не восстанавливается", async () => {
    await installLessons(db, ["lesson-3-4"]);
    await db.words.update("w34-03", { deletedAt: "2026-01-01T00:00:00.000Z" });
    mount();
    await until(() => text().includes("Слово из урока"), "карточка просмотра");
    expect((await db.words.get("w34-03"))?.deletedAt).toBeTruthy();
  });

  it("пока каталог грузится — загрузка, а после его ответа — карточка", async () => {
    mount();
    await until(busy, "загрузка");
    expect(text()).not.toContain("не найдено");
    await act(async () => {
      await refreshCatalog();
    });
    await until(() => text().includes("η κατσαρόλα"), "карточка");
  });

  it("повторное обновление каталога не возвращает карточку в загрузку", async () => {
    await refreshCatalog();
    mount();
    await until(() => text().includes("η κατσαρόλα"), "карточка");
    let flashed = false;
    const observer = new MutationObserver(() => {
      if (busy()) flashed = true;
    });
    observer.observe(host, { subtree: true, childList: true, attributes: true });
    await act(async () => {
      await refreshCatalog();
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    observer.disconnect();
    expect(flashed).toBe(false);
    expect(text()).toContain("η κατσαρόλα");
  });

  it("слова нет в каталоге — «Слово не найдено»", async () => {
    await refreshCatalog();
    mount("/share/word/w99-99");
    await until(() => text().includes("Слово не найдено"), "не найдено");
  });

  it("каталог не загрузился — сбой с повтором", async () => {
    const good = memoryFetcher();
    const broken = memoryFetcher();
    broken.json = async () => {
      throw new ContentError("Нет сети", "network");
    };
    useFetcher(broken);
    await refreshCatalog().catch(() => undefined);
    mount();
    await until(() => text().includes("Повторить"), "сбой каталога");
    useFetcher(good);
    await act(async () => {
      [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Повторить"))!.click();
    });
    await until(() => text().includes("η κατσαρόλα"), "карточка после повтора");
  });

  it("пакет не загрузился или не совпал с каталогом — сбой с повтором", async () => {
    await refreshCatalog();
    const url = content.catalog.lessons.find((l) => l.id === "lesson-3-4")!.url;
    const other = content.packages.find((p) => p.id === "lesson-1-1")!;
    useFetcher(memoryFetcher(content, { [url]: other }));
    mount();
    await until(() => text().includes("Пакет не соответствует записи каталога"), "сбой пакета");
    expect(text()).not.toContain("η κατσαρόλα");
    useFetcher(memoryFetcher());
    await act(async () => {
      [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Повторить"))!.click();
    });
    await until(() => text().includes("η κατσαρόλα"), "карточка после повтора");
  });
});
