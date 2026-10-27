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
function render(days: { lessons: string[]; reviews: string[] }, pausedAt?: string) {
  root?.unmount();
  host?.remove();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() =>
    root!.render(
      <Weeks data={{ days, week }} pausedAt={pausedAt} timezone="UTC" summary="На этой неделе: …" level={2} />,
    ),
  );
}
const labels = () => [...host.querySelectorAll("li .sr-only")].map((item) => item.textContent);
const ticks = () => [...host.querySelectorAll("li")].map((item) => item.textContent!.includes("✓"));

describe("«Занятия по неделям» на «Прогрессе»", () => {
  it("неделя читается одной подписью: даты, дни уроков и повторения, цель", () => {
    render({ lessons: ["2026-10-20", "2026-10-22"], reviews: ["2026-10-21", "2026-10-27"] });
    expect(labels()).toEqual([
      "Неделя с 19 октября: 2 дня уроков, повторение 1 день, цель недели выполнена",
      "Неделя с 26 октября: уроков нет, повторение 1 день",
    ]);
    expect(host.querySelector("[tabindex='0']")?.getAttribute("aria-label")).toBe("Недели с начала занятий");
  });

  it("✓ только под неделей с двумя днями уроков, счёта недель подряд нет", () => {
    render({ lessons: ["2026-10-13", "2026-10-15", "2026-10-20"], reviews: [] });
    expect(ticks()).toEqual([true, false, false]);
    expect(host.textContent).not.toMatch(/подряд|серия/);
  });

  it("без занятий — только строка недели", () => {
    render({ lessons: [], reviews: [] });
    expect(host.querySelector("ol")).toBeNull();
    expect(host.querySelector("[data-testid='week']")?.textContent).toBe("На этой неделе: …");
  });

  it("пауза показана в легенде, когда в сетке есть дни паузы", () => {
    render({ lessons: ["2026-10-20"], reviews: [] }, "2026-10-23T10:00:00.000Z");
    expect(host.textContent).toContain("пауза");
    render({ lessons: ["2026-10-20"], reviews: [] });
    expect(host.textContent).not.toContain("пауза");
  });
});
