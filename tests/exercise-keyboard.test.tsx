// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionItem, Word } from "../src/domain/types";
import { Assembly } from "../src/features/learning/exercises/Assembly";
import { Choice } from "../src/features/learning/exercises/Choice";
import { Spelling } from "../src/features/learning/exercises/Spelling";
import { WordGap } from "../src/features/learning/exercises/WordGap";
import type { Answer } from "../src/features/learning/exercises/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;

const word: Word = {
  id: "w-water",
  greek: "νερό",
  russian: "вода",
  ipa: "",
  segments: [],
  examples: [],
  verified: true,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const item = (type: SessionItem["type"], options: string[] = []): SessionItem => ({
  id: `i-${type}`,
  ref: { kind: "word", id: word.id },
  unitKey: `word:${word.id}`,
  card: { kind: "word", word },
  type,
  options,
  isNew: false,
  mode: "practice",
  expectedVersion: 0,
});

let root: Root;
let host: HTMLElement;
let answers: Answer[];
const onAnswer = async (answer: Answer) => {
  answers.push(answer);
  return true;
};
const pointer = (fine: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: fine && query === "(pointer: fine)" }));

beforeEach(() => {
  answers = [];
  pointer(true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = async (node: React.ReactNode) => act(async () => root.render(node));
const press = async (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
};
const focused = () => document.activeElement?.textContent;
const frame = () => act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
const buttons = (label: string) =>
  [...host.querySelectorAll("button")].find((button) => button.textContent === label) as HTMLButtonElement;
const assembled = () => [...host.querySelectorAll("[data-testid=placed]")].map((placed) => placed.textContent).join("");

describe("письмо с клавиатуры", () => {
  it("поле ответа получает фокус при открытии задания", async () => {
    await render(<Spelling item={item("spelling")} onAnswer={onAnswer} onNext={() => undefined} />);
    expect(document.activeElement).toBe(host.querySelector("input"));
  });
  it("поле пропуска во фразе получает фокус при открытии задания", async () => {
    const phrase = { id: "p-water", text: "Θέλω νερό", translation: "Хочу воды", createdAt: "", updatedAt: "" };
    const gap = { ...item("wordGap"), card: { kind: "phrase" as const, phrase }, gap: 1 };
    await render(<WordGap item={gap} onAnswer={onAnswer} onNext={() => undefined} />);
    expect(document.activeElement).toBe(host.querySelector("input"));
  });
  it("на сенсорном экране фокус не ставится — клавиатура не закрывает задание", async () => {
    pointer(false);
    await render(<Spelling item={item("spelling")} onAnswer={onAnswer} onNext={() => undefined} />);
    expect(document.activeElement).not.toBe(host.querySelector("input"));
  });
});

describe("выбор варианта с клавиатуры", () => {
  const options = ["вода", "хлеб", "дом", "кот"];
  const choice = (shown = options) => (
    <>
      <button type="button">Закрыть занятие</button>
      <Choice
        item={item("recognition", shown)}
        onAnswer={onAnswer}
        onNext={() => undefined}
        prompt="Что значит это слово?"
        options={shown}
        correct="вода"
      />
    </>
  );
  it("цифра выбирает вариант по номеру", async () => {
    await render(choice());
    await press("3");
    expect(answers).toEqual([{ correct: false, text: "дом" }]);
  });
  it("после открытия фокус на группе вариантов, а не на варианте", async () => {
    await render(choice());
    expect(document.activeElement?.getAttribute("role")).toBe("group");
  });
  it("на сенсорном экране группа фокус не получает", async () => {
    pointer(false);
    await render(choice());
    expect(document.activeElement).toBe(document.body);
  });
  it("в сетке из трёх вариантов стрелка вниз со второго остаётся на месте", async () => {
    await render(choice(["вода", "хлеб", "дом"]));
    await press("ArrowRight");
    await press("ArrowRight");
    await press("ArrowDown");
    expect(focused()).toBe("хлеб");
  });
  it("цифры не выбирают, пока фокус вне задания", async () => {
    await render(choice());
    act(() => buttons("Закрыть занятие").focus());
    await press("2");
    expect(answers).toEqual([]);
  });
  it("удержанный Enter после ответа не нажимает «Далее»", async () => {
    await render(choice());
    await press("1");
    expect(focused()).toBe("Далее");
    expect((await press("Enter", { repeat: true })).defaultPrevented).toBe(true);
  });
  it("стрелки ходят по сетке вариантов по кругу, первая — от группы к первому варианту", async () => {
    await render(choice());
    await press("ArrowDown");
    expect(focused()).toBe("вода");
    await press("ArrowDown");
    expect(focused()).toBe("дом");
    await press("ArrowRight");
    expect(focused()).toBe("кот");
    await press("ArrowRight");
    expect(focused()).toBe("вода");
    await press("ArrowLeft");
    expect(focused()).toBe("кот");
  });
  it("после ответа цифры больше не выбирают", async () => {
    await render(choice());
    await press("1");
    await press("2");
    expect(answers).toHaveLength(1);
  });
});

describe("сборка слова с клавиатуры", () => {
  const assembly = () => (
    <Assembly item={item("assembly", ["ρό", "νε"])} onAnswer={onAnswer} onNext={() => undefined} />
  );
  it("цифры ставят слоги, Backspace убирает последний, Enter проверяет", async () => {
    await render(assembly());
    await press("1");
    expect(assembled()).toBe("ρό");
    await press("Backspace");
    await press("2");
    await press("1");
    expect(assembled()).toBe("νερό");
    await press("Enter");
    expect(answers).toMatchObject([{ correct: true }]);
  });
  it("поставленный стрелкой и нажатием слог передаёт фокус следующему свободному", async () => {
    await render(assembly());
    await press("ArrowRight");
    expect(focused()).toBe("ρό");
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    await frame();
    expect(focused()).toBe("νε");
  });
  it("Enter на слоге ставит слог, а не проверяет ответ", async () => {
    await render(assembly());
    await press("ArrowRight");
    await press("Enter");
    expect(answers).toEqual([]);
  });
  it("цифра, поставившая слог в фокусе, передаёт фокус следующему свободному", async () => {
    await render(assembly());
    await press("ArrowRight");
    await press("1");
    await frame();
    expect(focused()).toBe("νε");
  });
  it("Backspace при пустой сборке не перехватывается", async () => {
    await render(assembly());
    expect((await press("Backspace")).defaultPrevented).toBe(false);
  });
  it("поставленный слог второй раз не ставится", async () => {
    await render(assembly());
    await press("2");
    await press("2");
    expect(assembled()).toBe("νε");
  });
});
