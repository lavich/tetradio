// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { deviceTimezone, studyDay } from "../src/domain/learning";
import { wordKeyOf, wordRef } from "../src/domain/refs";
import { lessonLines } from "../src/features/today/lessons";
import { TodayScreen } from "../src/features/today/TodayScreen";
import { setPrimaryCourse } from "../src/storage/courses";
import { db } from "../src/storage/db";
import { activeOf, install, lessonTitle, NOW, seedCatalog, wordId } from "./helpers/language-db";
import { pauseCourse, resumeCourse } from "../src/storage/pause-actions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 20_000 });

let root: Root | null = null;
let host: HTMLElement;
let location = "";
function Where() {
  const at = useLocation();
  location = at.pathname;
  return null;
}
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedCatalog(db);
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function start(courses: [string, Parameters<typeof install>[2]?][]) {
  for (const [index, [id, options]] of courses.entries())
    await install(db, id, { at: new Date(NOW.getTime() + index * 1000).toISOString(), ...options });
}
const mount = () => {
  root = createRoot(host);
  act(() =>
    root!.render(
      <MemoryRouter>
        <Where />
        <Routes>
          <Route path="/" element={<TodayScreen />} />
          <Route path="/course" element={<p>полка</p>} />
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
const all = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
const lines = () => all('[data-testid="course-line"]').map((line) => line.textContent);
const loaded = () => until(() => !!host.querySelector('[data-testid="course-next"]'), "крупный урок");

describe("строки уроков", () => {
  it("не больше трёх, остальные — «ещё»", () => {
    expect(lessonLines(["a", "b"])).toEqual({ shown: ["a", "b"], more: [] });
    expect(lessonLines(["a", "b", "c", "d", "e"])).toEqual({ shown: ["a", "b", "c"], more: ["d", "e"] });
    expect(lessonLines(["a", "b", "c"], 2)).toEqual({ shown: ["a", "b"], more: ["c"] });
  });
});

describe("блок основного языка", () => {
  it("два курса: общий лист «Повторение», крупный урок основного с подписью, строка второго курса", async () => {
    await start([
      ["it", { due: 3 }],
      ["travel", { due: 2 }],
      ["greek", { due: 1 }],
    ]);
    mount();
    await loaded();
    await until(() => !!host.querySelector('[data-testid="cards-today"]'), "лист повторения");
    expect(host.querySelector('[data-testid="cards-today"]')!.textContent).toBe("3 новые · 5 повторений");
    const big = host.querySelector('[data-testid="course-next"]')!;
    expect(big.querySelector('[data-testid="course-caption"]')?.textContent).toBe("Для IT");
    expect(big.textContent).toContain(lessonTitle("it", 2));
    await until(() => lines().length === 1, "строка второго курса");
    expect(lines()[0]).toContain("Для путешествий");
    expect(lines()[0]).toContain(`Урок: ${lessonTitle("travel", 2)}`);
    expect(host.querySelector('a[data-testid="course-line"]')?.getAttribute("href")).toBe("/course/travel-m1/travel-2");
  });
  it("четыре курса языка — три строки и «Ещё 1 курс →», которая открывает «Курс»", async () => {
    await start([["it"], ["travel"], ["talk"], ["four"]]);
    mount();
    await loaded();
    await until(() => lines().length === 2, "строки курсов");
    const more = host.querySelector<HTMLAnchorElement>('[data-testid="more-courses"]')!;
    expect(more.textContent).toBe("Ещё 1 курс →");
    expect(more.getAttribute("aria-label")).toBe("Английский: ещё 1 курс на «Курсе»");
    await act(async () => more.click());
    await until(() => location === "/course", "переход на «Курс»");
  });
  it("«N карточек сегодня» и точки недели — по курсам языка", async () => {
    await start([
      ["it", { ahead: true }],
      ["travel", { ahead: true }],
    ]);
    const today = studyDay(new Date(), deviceTimezone());
    const now = new Date().toISOString();
    await db.events.add({
      id: "e1",
      sessionId: "s",
      itemId: "i",
      ref: wordRef(wordId("travel", 0)),
      unitKey: wordKeyOf(wordId("travel", 0)),
      snapshot: { greek: "", russian: "" },
      type: "recognition",
      mode: "scheduled",
      rating: 3,
      correct: true,
      answer: "",
      createdAt: now,
      localDate: today,
      responseTimeMs: 900,
    });
    await db.blockProgress.add({ key: "travel-1/b", lessonId: "travel-1", blockId: "b", done: true, updatedAt: now });
    mount();
    await loaded();
    await until(() => !!host.querySelector('[data-testid="day-done"]'), "повторение сделано");
    expect(host.querySelector('[data-testid="day-done"]')!.textContent).toBe("1 карточка сегодня");
    expect(host.querySelector('[aria-label^="занятий на этой неделе"]')?.getAttribute("aria-label")).toBe(
      "занятий на этой неделе: 1",
    );
  });
  it("страж: один курс языка — без подписи и строк, вид прежний", async () => {
    await start([["greek", { due: 1 }], ["it"]]);
    mount();
    await loaded();
    expect(host.querySelector('[data-testid="course-caption"]')).toBeNull();
    expect(lines()).toEqual([]);
  });
  it("основной курс — первая строка и при другом основном курсе языка", async () => {
    await start([["it"], ["travel"]]);
    await setPrimaryCourse("travel", db);
    mount();
    await loaded();
    await until(() => lines().length === 1, "строка второго курса");
    expect(host.querySelector('[data-testid="course-next"] [data-testid="course-caption"]')?.textContent).toBe(
      "Для путешествий",
    );
    expect(lines()[0]).toContain("Для IT");
  });
});

describe("компактный блок языка", () => {
  const block = () => host.querySelector<HTMLElement>('[data-testid="other-language"]');
  const blockLines = () =>
    [...(block()?.querySelectorAll<HTMLElement>('[data-testid="course-line"]') ?? [])].map((line) => line.textContent);
  const shown = () => until(() => !!block() && blockLines().length > 0, "блок английского");

  it("один блок «Английский» с общим «Повторить N» и строками уроков обоих курсов с подписями", async () => {
    await start([
      ["greek", { ahead: true }],
      ["it", { due: 3, ahead: true }],
      ["travel", { due: 2, ahead: true }],
    ]);
    mount();
    await loaded();
    await shown();
    expect(all('[data-testid="other-language"]')).toHaveLength(1);
    expect(block()!.querySelector("h2")?.textContent).toBe("Английский");
    expect(block()!.querySelector("button")?.textContent).toBe("Повторить 5");
    await until(() => blockLines().length === 2, "две строки");
    expect(blockLines()[0]).toContain("Для IT");
    expect(blockLines()[0]).toContain(`Урок: ${lessonTitle("it", 2)}`);
    expect(blockLines()[1]).toContain("Для путешествий");
    expect(block()!.textContent).not.toContain("Чтение");
    expect(block()!.querySelector('[data-testid="after-pause"]')).toBeNull();
  });
  it("без карточек — «повторений нет»; незаконченное занятие языка — «Продолжить»", async () => {
    await start([
      ["greek", { ahead: true }],
      ["it", { ahead: true }],
      ["travel", { ahead: true }],
    ]);
    mount();
    await loaded();
    await shown();
    await until(() => block()!.textContent!.includes("повторений нет"), "повторений нет");
    await act(async () => void (await db.sessions.add(activeOf("en", "travel", { language: "en" }))));
    await until(() => block()!.querySelector("button")?.textContent === "Продолжить", "«Продолжить»");
  });
  it("долг паузы одного курса — строка «После паузы…» в блоке языка", async () => {
    await start([
      ["greek", { ahead: true }],
      ["it", { due: 2, ahead: true }],
      ["travel", { ahead: true }],
    ]);
    await pauseCourse("it", new Date(Date.now() - 86_400_000), db);
    await resumeCourse("it", new Date(), db);
    mount();
    await loaded();
    await shown();
    await until(() => !!block()!.querySelector('[data-testid="after-pause"]'), "строка после паузы");
    expect(block()!.querySelector('[data-testid="after-pause"]')!.textContent).toBe(
      "После паузы: сначала то, что могло забыться",
    );
  });
  it("курс языка на паузе — одна строка без подписи, счёт без него", async () => {
    await start([
      ["greek", { ahead: true }],
      ["it", { due: 3, ahead: true }],
      ["travel", { due: 2, ahead: true }],
    ]);
    await pauseCourse("travel", new Date(), db);
    mount();
    await loaded();
    await shown();
    await until(() => block()!.querySelector("button")?.textContent === "Повторить 3", "счёт без курса на паузе");
    expect(blockLines()).toHaveLength(1);
    expect(block()!.querySelector('[data-testid="course-caption"]')).toBeNull();
  });
  it("язык, все курсы которого на паузе, — без блока", async () => {
    await start([["greek", { ahead: true }], ["it"], ["travel"]]);
    await pauseCourse("it", new Date(), db);
    await pauseCourse("travel", new Date(), db);
    mount();
    await loaded();
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(block()).toBeNull();
  });
});
