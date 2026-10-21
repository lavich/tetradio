// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { wordRef } from "../src/domain/refs";
import { ResultScreen } from "../src/features/learning/ResultScreen";
import { SessionScreen } from "../src/features/learning/SessionScreen";
import { sessionPath, startSession } from "../src/features/learning/session-actions";
import { db } from "../src/storage/db";
import { recordAnswer } from "../src/storage/ops";
import { pauseCourse } from "../src/storage/pause-actions";
import { activeOf, install, NOW, seedCatalog, wordId, wordOf } from "./helpers/language-db";

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 20_000 });
if (!globalThis.ResizeObserver)
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

let root: Root | null = null;
let host: HTMLElement;
let location = "";
function Where() {
  const at = useLocation();
  location = at.pathname + at.search;
  return null;
}
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedCatalog(db);
  for (const [index, id] of ["greek", "it", "travel"].entries())
    await install(db, id, { due: 2, at: new Date(NOW.getTime() + index * 1000).toISOString() });
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const mount = (url: string) => {
  root = createRoot(host);
  act(() =>
    root!.render(
      <MemoryRouter initialEntries={[url]}>
        <Where />
        <Routes>
          <Route path="/session" element={<SessionScreen />} />
          <Route path="/session/result/:id" element={<ResultScreen />} />
          <Route path="*" element={<p>главная</p>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
};
async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw new Error(`не дождались: ${what}\n${host.textContent}`);
}
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const shows = (courseId: string) => host.textContent!.includes(wordOf(courseId, 0).greek);

describe("адрес занятия языка", () => {
  beforeEach(async () => {
    await db.sessions.bulkAdd([
      activeOf("english", "it", { language: "en" }),
      activeOf("greek", "greek", { language: "el", createdAt: later(10) }),
    ]);
  });
  it("/session?language=en открывает незаконченное занятие английского", async () => {
    mount("/session?language=en");
    await until(() => shows("it"), "английское занятие");
  });
  it("прежний /session?course=it открывает занятие английского языка", async () => {
    mount("/session?course=it");
    await until(() => shows("it"), "английское занятие");
  });
  it("/session — занятие языка «Сегодня»", async () => {
    mount("/session");
    await until(() => shows("greek"), "греческое занятие");
  });
});

describe("адрес по занятию", () => {
  it("занятие без курса — языка домашнего курса, по /session", async () => {
    const old = activeOf("old", undefined);
    await db.sessions.add(old);
    expect(await sessionPath(old)).toBe("/session");
    mount("/session");
    await until(() => shows("greek"), "прежнее занятие");
  });
  it("тренировка урока курса на паузе открывается по адресу своего занятия", async () => {
    await pauseCourse("travel", NOW, db);
    const session = (await startSession(NOW, {
      refs: [wordRef(wordId("travel", 0)), wordRef(wordId("travel", 1))],
      mode: "practice",
      courseId: "travel",
    }))!;
    const path = await sessionPath(session);
    expect(path).toBe("/session?language=en");
    mount(path);
    await until(() => host.textContent!.includes("из 2"), "задание тренировки");
    expect(host.textContent).not.toContain("Активного занятия нет");
  });
  it("«Повторить ошибки» в итоге тренировки курса на паузе открывает занятие языка с этими карточками", async () => {
    await pauseCourse("travel", NOW, db);
    const practice = (await startSession(new Date(), {
      refs: [wordRef(wordId("travel", 0))],
      mode: "practice",
      courseId: "travel",
    }))!;
    await recordAnswer({
      session: practice,
      item: practice.items[0],
      correct: false,
      answer: "",
      responseTimeMs: 1000,
      activeTimeMs: 1000,
      timezone: "UTC",
    });
    mount(`/session/result/${practice.id}`);
    const again = () =>
      [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Повторить ошибки"));
    await until(() => !!again(), "кнопка «Повторить ошибки»");
    await act(async () => again()!.click());
    await until(() => location.startsWith("/session?") || location === "/session", "переход в занятие");
    await until(() => host.textContent!.includes("из 1"), "задание нового занятия");
    const created = (await db.sessions.toArray()).find((session) => session.id !== practice.id)!;
    expect(created).toMatchObject({ language: "en", courseId: "travel" });
    expect(created.items.map((item) => item.ref.id)).toEqual([wordId("travel", 0)]);
  });
});
