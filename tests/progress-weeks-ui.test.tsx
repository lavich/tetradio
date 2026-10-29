// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { Weeks } from "../src/features/progress/Weeks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

let root: Root | null = null;
let host: HTMLElement;
afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
});

const week = { today: "2026-10-27", monday: "2026-10-26", lessonDays: [], reviewDays: ["2026-10-27"], cards: 3 };
function render(days: { lessons: string[]; reviews: string[] }, pausedAt?: string, language = false) {
  root?.unmount();
  host?.remove();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() =>
    root!.render(
      <Weeks
        data={{ days, week }}
        pausedAt={pausedAt}
        timezone="UTC"
        summary="На этой неделе: …"
        language={language}
        level={2}
      />,
    ),
  );
}
const region = () => host.querySelector<HTMLElement>("[role='region']");
const items = () => [...host.querySelectorAll("[role='list'] > li")];
const labels = () => items().map((item) => item.querySelector(".sr-only")!.textContent);
const ticks = () => items().map((item) => item.textContent!.includes("✓"));
const cells = (index: number) => [...items()[index].querySelectorAll("i")].map((cell) => cell.className);

describe("«Занятия по неделям» на «Прогрессе»", () => {
  it("неделя читается одной подписью: даты, уроки, повторение, ориентир; текущая — «эта неделя»", () => {
    render({ lessons: ["2026-10-20", "2026-10-22"], reviews: ["2026-10-21", "2026-10-27"] });
    expect(labels()).toEqual([
      "Неделя с 19 октября: уроки в 2 дня, повторение 1 день, ориентир недели выполнен",
      "Эта неделя: уроков нет, повторение 1 день",
    ]);
    expect(region()?.getAttribute("aria-label")).toBe("Недели с начала занятий");
    expect(host.textContent).toContain("С начала курса, 20 октября. Ориентир — 2–3 занятия в неделю.");
  });

  it("у суммы языка — «с начала занятий»", () => {
    render({ lessons: ["2026-10-20"], reviews: [] }, undefined, true);
    expect(host.textContent).toContain("С начала занятий, 20 октября.");
  });

  it("клетки: урок, повторение, сегодня, будущие дни", () => {
    render({ lessons: ["2026-10-26"], reviews: ["2026-10-26", "2026-10-27"] });
    const [monday, tuesday, wednesday] = cells(0);
    expect(monday).toMatch(/dayLesson/);
    expect(monday).toMatch(/dayReview/);
    expect(tuesday).toMatch(/dayToday/);
    expect(tuesday).toMatch(/dayReview/);
    expect(tuesday).not.toMatch(/dayLesson/);
    expect(wednesday).toMatch(/dayFuture/);
  });

  it("✓ только под неделей с двумя днями уроков", () => {
    render({ lessons: ["2026-10-13", "2026-10-15", "2026-10-20"], reviews: [] });
    expect(ticks()).toEqual([true, false, false]);
  });

  it("без занятий — только строка недели", () => {
    render({ lessons: [], reviews: [] });
    expect(host.querySelector("[role='list']")).toBeNull();
    expect(host.querySelector("[data-testid='week']")?.textContent).toBe("На этой неделе: …");
  });

  it("пауза штрихует дни, называется в подписи недели и в легенде", () => {
    render({ lessons: ["2026-10-20"], reviews: [] }, "2026-10-23T10:00:00.000Z");
    expect(cells(0)[4]).toMatch(/dayPaused/);
    expect(labels()[0]).toContain("пауза");
    expect(host.querySelector("p[aria-hidden]")?.textContent).toContain("пауза");
    render({ lessons: ["2026-10-20"], reviews: [] });
    expect(host.textContent).not.toContain("пауза");
  });

  describe("ширина и прокрутка", () => {
    const restore: (() => void)[] = [];
    afterEach(() => restore.splice(0).forEach((undo) => undo()));
    const stub = (name: "clientWidth" | "scrollWidth" | "scrollLeft", descriptor: PropertyDescriptor) => {
      const previous = Object.getOwnPropertyDescriptor(Element.prototype, name)!;
      Object.defineProperty(Element.prototype, name, { configurable: true, ...descriptor });
      restore.push(() => Object.defineProperty(Element.prototype, name, previous));
    };
    const has = (element: HTMLElement, name: string) => element.className.includes(name);
    function layout(frameWidth: number) {
      const left = new WeakMap<HTMLElement, number>();
      stub("clientWidth", {
        get(this: HTMLElement) {
          if (!(this instanceof HTMLElement)) return 0;
          if (has(this, "weekFrame")) return frameWidth;
          if (has(this, "weekScroll")) return parseFloat(this.style.width) || 0;
          return 0;
        },
      });
      stub("scrollWidth", {
        get(this: HTMLElement) {
          const list = has(this, "weekScroll") ? this.querySelector("ol") : has(this, "weekList") ? this : null;
          if (!list) return 0;
          const own = list.children.length * 20 - 4;
          return this === list ? own : Math.max(own, parseFloat(list.style.minWidth) || 0);
        },
      });
      stub("scrollLeft", {
        get(this: HTMLElement) {
          return left.get(this) ?? 0;
        },
        set(this: HTMLElement, value: number) {
          left.set(this, value);
        },
      });
    }
    const thirty = Array.from({ length: 30 }, (_, index) =>
      new Date(Date.UTC(2026, 3, 6 + index * 7)).toISOString().slice(0, 10),
    );

    it("видна целая доля столбцов, а при открытии — текущая неделя справа", () => {
      layout(300);
      render({ lessons: thirty, reviews: [] });
      const area = region()!;
      expect(area.style.width).toBe("296px");
      expect(area.scrollLeft).toBe(area.scrollWidth);
      expect(area.getAttribute("tabindex")).toBe("0");
    });

    it("когда всё помещается, прокрутки и точки табуляции нет", () => {
      layout(1000);
      render({ lessons: ["2026-10-20"], reviews: [] });
      expect(region()!.style.width).toBe("36px");
      expect(region()!.hasAttribute("tabindex")).toBe(false);
    });
  });
});
