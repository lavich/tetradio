// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionItem, Word } from "../src/domain/types";
import { Assembly } from "../src/features/learning/exercises/Assembly";
import { Choice } from "../src/features/learning/exercises/Choice";
import { Spelling } from "../src/features/learning/exercises/Spelling";
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
const press = async (key: string) =>
  act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
const assembled = () => [...host.querySelectorAll("[data-testid=placed]")].map((placed) => placed.textContent).join("");

describe("письмо с клавиатуры", () => {
  it("поле ответа получает фокус при открытии задания", async () => {
    await render(<Spelling item={item("spelling")} onAnswer={onAnswer} onNext={() => undefined} />);
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
  const choice = () => (
    <Choice
      item={item("recognition", options)}
      onAnswer={onAnswer}
      onNext={() => undefined}
      prompt="Что значит это слово?"
      options={options}
      correct="вода"
    />
  );
  it("цифра выбирает вариант по номеру", async () => {
    await render(choice());
    await press("3");
    expect(answers).toEqual([{ correct: false, text: "дом" }]);
  });
  it("Tab с открытого задания ведёт к первому варианту", async () => {
    await render(choice());
    expect(document.activeElement?.contains(host.querySelector("[data-testid=option]"))).toBe(true);
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
  it("поставленный слог второй раз не ставится", async () => {
    await render(assembly());
    await press("2");
    await press("2");
    expect(assembled()).toBe("νε");
  });
});
