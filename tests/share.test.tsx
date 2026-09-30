// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { shareWord, wordLink } from "../src/platform/share";
import { launchContext, resetLaunchContext } from "../src/platform/launch";
import type { TelegramWebApp } from "../src/platform/telegram-types";
import { WordScreen } from "../src/features/words/WordScreen";
import { refreshCatalog, resetCatalogPhase } from "../src/content/client";
import { db } from "../src/storage/db";
import { saveWord } from "../src/storage/ops";
import { content, installLessons, memoryFetcher } from "./helpers/content";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const word = { id: "w34-03", greek: "η κατσαρόλα", russian: "кастрюля" };
const nav = navigator as { share?: unknown; clipboard?: unknown };
let copied: string[];
beforeEach(() => {
  copied = [];
  toast.success.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  });
});
afterEach(() => {
  delete nav.share;
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  resetLaunchContext();
});

describe("отправка ссылки на слово", () => {
  it("в Telegram открывает выбор чата со ссылкой через бота и названием слова", async () => {
    const opened: string[] = [];
    const app = { openTelegramLink: (url: string) => opened.push(url) } as unknown as TelegramWebApp;
    await shareWord(word, "TaveloriDevBot", app);
    const target = new URL(opened[0]);
    expect(`${target.origin}${target.pathname}`).toBe("https://t.me/share/url");
    expect(target.searchParams.get("url")).toBe("https://t.me/TaveloriDevBot?startapp=w_w34-03");
    expect(target.searchParams.get("text")).toBe("η κατσαρόλα — кастрюля");
    expect(copied).toEqual([]);
  });
  it("в браузере открывает системное меню, отмена ничего не копирует", async () => {
    const shared: unknown[] = [];
    nav.share = async (data: unknown) => void shared.push(data);
    await shareWord(word, "TaveloriBot", null);
    expect(shared).toEqual([{ url: "https://t.me/TaveloriBot?startapp=w_w34-03", text: "η κατσαρόλα — кастрюля" }]);
    nav.share = async () => {
      throw Object.assign(new Error("cancel"), { name: "AbortError" });
    };
    await shareWord(word, "TaveloriBot", null);
    expect(copied).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("без системного меню или при его сбое копирует ссылку и сообщает об этом", async () => {
    await shareWord(word, "TaveloriBot", null);
    nav.share = async () => {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    };
    await shareWord(word, "TaveloriBot", null);
    expect(copied).toEqual([wordLink("w34-03", "TaveloriBot"), wordLink("w34-03", "TaveloriBot")]);
    expect(toast.success).toHaveBeenCalledWith("Ссылка скопирована");
  });
});

describe("бот ссылки", () => {
  const open = (path: string) => {
    window.history.replaceState(null, "", path);
    resetLaunchContext();
    launchContext();
  };
  it("в браузере без ?bot= — основной бот", async () => {
    open("/");
    await shareWord(word, undefined, null);
    expect(copied).toEqual(["https://t.me/TaveloriBot?startapp=w_w34-03"]);
  });
  it("с ?bot=TaveloriDevBot — dev-бот, и после перехода, и после перезагрузки", async () => {
    open("/?bot=TaveloriDevBot");
    await shareWord(word, undefined, null);
    window.history.pushState(null, "", "/words/w34-03"); // переход маршрутизатора убирает ?bot=
    await shareWord(word, undefined, null);
    open("/words/w34-03"); // перезагрузка
    await shareWord(word, undefined, null);
    const tg = `#tgWebAppPlatform=ios&tgWebAppData=${encodeURIComponent("auth_date=1&hash=a&start_param=w_w34-03")}`;
    open(`/?bot=TaveloriDevBot${tg}`);
    open("/share/word/w34-03");
    await shareWord(word, undefined, null);
    expect(copied).toEqual(Array(4).fill("https://t.me/TaveloriDevBot?startapp=w_w34-03"));
  });
});

describe("кнопка «Поделиться» на экране слова", () => {
  let root: Root | null = null;
  let host: HTMLElement;
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    resetCatalogPhase();
    host = document.body.appendChild(document.createElement("div"));
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
  });
  const mount = async (id: string) => {
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <MemoryRouter initialEntries={[`/words/${id}`]}>
          <Routes>
            <Route path="/words/:id" element={<WordScreen />} />
          </Routes>
        </MemoryRouter>,
      ),
    );
  };
  const button = () => host.querySelector("[aria-label='Поделиться словом']");
  const edit = () => host.querySelector("[aria-label='Редактировать слово']");
  async function until(check: () => boolean) {
    for (let i = 0; i < 200 && !check(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(check()).toBe(true);
  }

  it("есть у слова курса", async () => {
    await installLessons(db, ["lesson-3-4"]);
    await mount("w34-03");
    await until(() => !!button());
  });
  it("нет у своего слова и у удалённого слова курса", async () => {
    await installLessons(db, ["lesson-3-4"]);
    await saveWord({ ...(await db.words.get("w34-03"))!, id: "own-1", revision: undefined, greek: "το δικό μου" });
    await db.words.update("w34-03", { deletedAt: "2026-01-01T00:00:00.000Z" });
    await mount("own-1");
    await until(() => !!edit());
    expect(button()).toBeNull();
    act(() => root!.unmount());
    await mount("w34-03");
    await until(() => !!edit());
    expect(button()).toBeNull();
  });
  it("отправляет слово в версии курса, без правки пользователя", async () => {
    await installLessons(db, ["lesson-3-4"]);
    await saveWord({ ...(await db.words.get("w34-03"))!, russian: "моя кастрюлька" });
    const shared: { text?: string }[] = [];
    nav.share = async (data: { text?: string }) => void shared.push(data);
    await mount("w34-03");
    await until(() => !!button());
    await act(async () => (button() as HTMLElement).click());
    await until(() => shared.length === 1);
    expect(shared[0].text).toBe("η κατσαρόλα — кастрюля");
  });
  it("появляется без перемонтажа, когда каталог с индексом слов записан", async () => {
    const old = {
      ...content.catalog,
      lessons: content.catalog.lessons.map(({ wordIds: _w, ...entry }) => entry),
    };
    await installLessons(db, ["lesson-3-4"], memoryFetcher(content, { "content/catalog.json": old }));
    await mount("w34-03");
    await until(() => !!edit());
    expect(button()).toBeNull();
    await act(async () => {
      await refreshCatalog(db, memoryFetcher());
    });
    await until(() => !!button());
  });
});
