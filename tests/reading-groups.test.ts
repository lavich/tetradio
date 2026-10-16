import { describe, expect, it } from "vitest";
import { closedLine, groupByModule, readingExits } from "../src/features/course/reading-groups";
import type { ReadingView } from "../src/storage/readings";

const view = (id: string, moduleNumber: number, read = false): ReadingView =>
  ({
    reading: { id, title: id },
    moduleId: `m0${moduleNumber}`,
    module: { number: moduleNumber, title: `Модуль ${moduleNumber}` },
    open: true,
    ...(read ? { readAt: "2026-10-12T09:00:00Z" } : {}),
  }) as ReadingView;
const ids = (views: ReadingView[]) => views.map((item) => item.reading.id);

describe("список текстов по модулям", () => {
  it("группы идут по программе, модуль без открытых текстов не появляется", () => {
    const groups = groupByModule([view("a", 1), view("b", 3), view("c", 3)]);
    expect(groups.map((group) => group.module.number)).toEqual([1, 3]);
    expect(groups.map((group) => ids(group.items))).toEqual([["a"], ["b", "c"]]);
  });

  it("внутри группы непрочитанные выше прочитанных, порядок программы сохранён", () => {
    const [group] = groupByModule([view("a", 1, true), view("b", 1), view("c", 1, true), view("d", 1)]);
    expect(ids(group.items)).toEqual(["b", "d", "a", "c"]);
  });

  it("без открытых текстов групп нет", () => {
    expect(groupByModule([])).toEqual([]);
  });

  it.each([
    [1, "Ещё 1 текст откроется после урока."],
    [2, "Ещё 2 текста откроются после уроков."],
    [5, "Ещё 5 текстов откроются после уроков."],
    [11, "Ещё 11 текстов откроются после уроков."],
    [21, "Ещё 21 текст откроется после урока."],
    [22, "Ещё 22 текста откроются после уроков."],
  ])("строка закрытых текстов для %i", (count, line) => {
    expect(closedLine(count)).toBe(line);
  });
});

describe("выходы с экрана текста", () => {
  const moduleNext = view("module-next", 1);
  const listNext = view("list-next", 2);

  it("из списка: «К списку текстов» и следующий текст списка", () => {
    expect(readingExits({ fromReadings: true }, moduleNext, listNext)).toEqual({
      label: "К списку текстов",
      toList: true,
      next: listNext,
    });
  });

  it("не из списка: «К модулю» и следующий текст модуля, если он открыт", () => {
    expect(readingExits({ fromModule: true }, moduleNext, listNext)).toEqual({
      label: "К модулю",
      toList: false,
      next: moduleNext,
    });
    expect(readingExits(null, { ...moduleNext, open: false }, listNext).next).toBeUndefined();
  });

  it("из списка без следующего непрочитанного — без следующего", () => {
    expect(readingExits({ fromReadings: true }, moduleNext, undefined).next).toBeUndefined();
  });
});
