// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { DayNotes } from "../src/features/today/DayNotes";
import { Segmented } from "../src/shared/CourseSwitch";
import { sessionPath } from "../src/features/learning/session-actions";
import { db } from "../src/storage/db";
import { rememberCourses, setPrimaryCourse } from "../src/storage/courses";
import { pauseCourse } from "../src/storage/pause-actions";
import type { DailyPlan } from "../src/domain/learning";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});
const mount = (screen: React.ReactNode) => {
  root = createRoot(host);
  act(() => root!.render(<MemoryRouter>{screen}</MemoryRouter>));
};

const plan = (over: Partial<DailyPlan> = {}): DailyPlan => ({
  today: "2026-10-20",
  newRefs: [],
  reviews: [],
  origins: new Map(),
  unavailable: [],
  wakeAt: new Date(),
  ...over,
});

describe("строка долга паузы", () => {
  it("есть при долге паузы, нет без него", () => {
    mount(<DayNotes plan={plan({ pauseDebt: 3 })} />);
    expect(host.querySelector('[data-testid="after-pause"]')?.textContent).toBe(
      "После паузы: сначала то, что могло забыться",
    );
    act(() => root!.render(<MemoryRouter>{<DayNotes plan={plan()} />}</MemoryRouter>));
    expect(host.querySelector('[data-testid="after-pause"]')).toBeNull();
  });
});

describe("выбор основного с курсом на паузе", () => {
  function Choice({ onChange }: { onChange: (id: string) => void }) {
    const [value, setValue] = useState("a");
    return (
      <Segmented
        label="Основной курс"
        testId="choice"
        value={value}
        options={[
          { id: "a", title: "Греческий" },
          { id: "b", title: "Английский", disabled: "на паузе" },
          { id: "c", title: "Третий" },
        ]}
        onChange={(id) => {
          onChange(id);
          setValue(id);
        }}
      />
    );
  }
  it("вариант на паузе неактивен: щелчок не выбирает, стрелка его пропускает", () => {
    const onChange = vi.fn();
    mount(<Choice onChange={onChange} />);
    const [greek, english] = host.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    expect(english.getAttribute("aria-disabled")).toBe("true");
    expect(english.getAttribute("aria-label")).toBe("Английский, на паузе");
    act(() => english.click());
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      greek.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("c");
  });
  it("выбранный основной на паузе показан выбранным", () => {
    mount(
      <Segmented
        label="Основной курс"
        testId="choice"
        value="b"
        options={[
          { id: "a", title: "Греческий" },
          { id: "b", title: "Английский", disabled: "на паузе" },
        ]}
        onChange={() => undefined}
      />,
    );
    const checked = host.querySelector('[aria-checked="true"]');
    expect(checked?.getAttribute("aria-label")).toBe("Английский, на паузе");
  });
});

describe("адрес занятия языка «Сегодня»", () => {
  it("язык следующего по кругу курса, ставший основным на «Сегодня» из-за паузы, открывается по /session", async () => {
    for (const [index, id] of ["greek", "english"].entries()) {
      await db.courses.add({
        id,
        title: id,
        language: id === "greek" ? "el" : "en",
        updatedAt: "2026-10-01T09:00:00Z",
      });
      await db.lessons.add({
        id: `${id}-1`,
        courseId: id,
        title: "1",
        completed: true,
        updatedAt: `2026-10-0${index + 1}T09:00:00Z`,
      });
      await rememberCourses(db);
    }
    await setPrimaryCourse("greek", db);
    expect(await sessionPath({ courseId: "english" })).toBe("/session?language=en");
    await pauseCourse("greek", new Date("2026-10-12T09:00:00Z"), db);
    expect(await sessionPath({ courseId: "english" })).toBe("/session");
    expect(await sessionPath({ courseId: "greek" })).toBe("/session?language=el");
  });
});
