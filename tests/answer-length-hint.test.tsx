// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Assembly, Spelling } from "../src/features/learning/exercises";
import type { Phrase, SessionItem, Word } from "../src/domain/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;

const word = (over: Partial<Word> = {}): Word => ({
  id: "w1",
  greek: "το σπίτι",
  russian: "дом",
  ipa: "to ˈspiti",
  segments: [],
  examples: [],
  verified: false,
  createdAt: "",
  updatedAt: "",
  ...over,
});
const phrase = (over: Partial<Phrase> = {}): Phrase => ({
  id: "p1",
  text: "Πώς σε λένε;",
  translation: "Как тебя зовут?",
  provenance: { sourceLabel: "тест", operation: "verbatim" },
  createdAt: "",
  updatedAt: "",
  ...over,
});

const wordItem = (over: Partial<Word> = {}): SessionItem => ({
  id: "i1",
  ref: { kind: "word", id: "w1" },
  unitKey: "word:w1",
  card: { kind: "word", word: word(over) },
  type: "spelling",
  options: [],
  isNew: false,
  mode: "scheduled",
  expectedVersion: 1,
});
const phraseItem = (): SessionItem => ({
  id: "i2",
  ref: { kind: "phrase", id: "p1" },
  unitKey: "phrase:p1",
  card: { kind: "phrase", phrase: phrase() },
  type: "spelling",
  options: [],
  isNew: false,
  mode: "scheduled",
  expectedVersion: 1,
});
const assemblyItem = (): SessionItem => ({ ...wordItem(), id: "i4", type: "assembly", options: ["τι", "σπί"] });

let root: Root | null = null,
  container: HTMLElement | null = null;
let answers = 0;
let sent: Array<{ text: string; status?: string }> = [];
beforeEach(() => {
  answers = 0;
  sent = [];
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const onAnswer = async (answer: { text: string; status?: string }) => {
  answers++;
  sent.push(answer);
  return true;
};
const show = async (element: React.ReactElement) => {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => {
    root!.render(element);
  });
  return container;
};
const showSpelling = (item: SessionItem) => show(<Spelling item={item} onAnswer={onAnswer} onNext={() => undefined} />);
const press = async (element: Element | undefined | null) => {
  await act(async () => {
    (element as HTMLElement).click();
  });
};
const button = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll("button")).find((item) => item.textContent === text);
const mask = (host: HTMLElement) => host.querySelector('[data-testid="answer-mask"]');
/** Читаемая запись маски: пустая ячейка — подчёркивание, показанный знак — сам знак, пробел — граница группы. */
const shown = (host: HTMLElement) =>
  Array.from(mask(host)!.querySelectorAll('[data-testid="mask-word"]'))
    .map((group) =>
      Array.from(group.children)
        .map((cell) => cell.textContent || "_")
        .join(""),
    )
    .join(" ");
/** Где стоит каретка: слово и позиция в нём — «за» ячейкой считается следующей позицией. */
const caret = (host: HTMLElement) => {
  const marker = mask(host)!.querySelector('[data-testid="mask-caret"]');
  if (!marker) return null;
  const group = marker.closest('[data-testid="mask-word"]')!;
  const groups = Array.from(mask(host)!.querySelectorAll('[data-testid="mask-word"]'));
  const at = Array.from(group.children).indexOf(marker);
  return { word: groups.indexOf(group), at: marker.getAttribute("data-caret") === "after" ? at + 1 : at };
};
const note = (host: HTMLElement) =>
  Array.from(host.querySelectorAll(".sr-only"))
    .map((item) => item.textContent)
    .find((text) => text?.startsWith("Ответ из"));

const type = async (host: HTMLElement, text: string) => {
  const input = host.querySelector("input") as HTMLInputElement;
  await act(async () => {
    // eslint-disable-next-line typescript/unbound-method -- сеттер прототипа вызывается через .call, привязка задаётся явно
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("подсказка длины ответа", () => {
  it("в написании слова открывает первую букву и прячет остальные", async () => {
    const host = await showSpelling(wordItem({ greek: "σπίτι" }));
    expect(shown(host)).toBe("σ____");
    expect(note(host)).toBe("Ответ из 5 букв, первая σ");
  });
  it("слово с артиклем даёт две группы", async () => {
    const host = await showSpelling(wordItem());
    expect(shown(host)).toBe("τ_ σ____");
    expect(note(host)).toBe("Ответ из 2 слов, 7 букв, первые буквы τ, σ");
  });
  it("во фразе знак препинания показан как есть и в счёт не входит", async () => {
    const host = await showSpelling(phraseItem());
    expect(shown(host)).toBe("Π__ σ_ λ___;");
    expect(note(host)).toBe("Ответ из 3 слов, 9 букв, первые буквы Π, σ, λ");
  });
  it("маска лежит в самом поле ввода и скрыта от экранного диктора", async () => {
    const host = await showSpelling(wordItem());
    const input = host.querySelector("input")!;
    expect(mask(host)!.getAttribute("aria-hidden")).toBe("true");
    expect(mask(host)!.parentElement!.contains(input)).toBe(true);
  });
  it("кроме первой буквы ожидаемое написание до ответа в DOM не попадает", async () => {
    const host = await showSpelling(wordItem());
    expect(shown(host)).toBe("τ_ σ____");
    expect(host.textContent).not.toContain("σπίτι");
    expect(host.textContent).not.toContain("πίτι");
    expect(host.textContent).not.toContain("το ");
  });
  it("набранное занимает ячейки, маска остаётся на месте", async () => {
    const host = await showSpelling(wordItem({ greek: "σπίτι" }));
    await type(host, "σπ");
    expect(shown(host)).toBe("σπ___");
    expect(note(host)).toBe("Ответ из 5 букв, первая σ");
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("σπ");
  });
  it("набранное показывается и там, где стояла открытая буква", async () => {
    const host = await showSpelling(wordItem({ greek: "σπίτι" }));
    await type(host, "κ");
    expect(shown(host)).toBe("κ____");
  });
  it("пробел переводит набор к следующему слову", async () => {
    const host = await showSpelling(wordItem());
    await type(host, "το σπ");
    expect(shown(host)).toBe("το σπ___");
  });
  it("без пробела буквы остаются в первом слове, а не выглядят как ответ с пробелом", async () => {
    const host = await showSpelling(wordItem());
    await type(host, "ηγάτα");
    expect(shown(host)).toBe("ηγάτα σ____");
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("ηγάτα");
  });
  it("ответ без артикля ложится в первое слово и ввод не ломает", async () => {
    const host = await showSpelling(wordItem());
    await type(host, "σπίτι");
    expect(shown(host)).toBe("σπίτι σ____");
  });
  it("лишние символы показаны за маской", async () => {
    const host = await showSpelling(wordItem({ greek: "σπίτι" }));
    await type(host, "σπίτια");
    expect(shown(host)).toBe("σπίτια");
  });
  it("каретка видна и в пустом поле, и внутри слова", async () => {
    const host = await showSpelling(wordItem({ greek: "σπίτι" }));
    expect(caret(host)).toEqual({ word: 0, at: 0 });
    await type(host, "σπ");
    expect(caret(host)).toEqual({ word: 0, at: 2 });
  });
  it("каретка стоит сразу за введённой буквой, а не перед пустой ячейкой", async () => {
    const host = await showSpelling(wordItem({ greek: "η γάτα" }));
    await type(host, "η");
    expect(caret(host)).toEqual({ word: 0, at: 1 });
    expect(mask(host)!.querySelector('[data-caret="after"]')!.textContent).toBe("η");
  });
  it("после пробела каретка переходит в начало следующего слова", async () => {
    const host = await showSpelling(wordItem({ greek: "η γάτα" }));
    await type(host, "η ");
    expect(caret(host)).toEqual({ word: 1, at: 0 });
  });
  it("за концом последнего слова каретка остаётся видимой", async () => {
    const host = await showSpelling(wordItem({ greek: "σπίτι" }));
    await type(host, "σπίτι");
    expect(caret(host)).toEqual({ word: 0, at: 5 });
  });
  it("пробел не подставляется сам: ответ без артикля остаётся как набран", async () => {
    const host = await showSpelling(wordItem());
    await type(host, "σπίτι");
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("σπίτι");
    expect(shown(host)).toBe("σπίτι σ____");
    expect(caret(host)).toEqual({ word: 0, at: 5 });
  });
  it("ответ не по маске проверяется по прежним правилам", async () => {
    const host = await showSpelling(wordItem());
    await type(host, "σπίτι");
    await press(button(host, "Проверить"));
    expect(sent).toEqual([{ correct: false, text: "σπίτι", status: "almost" }]);
    expect(host.querySelector('[data-testid="feedback"]')!.textContent).toContain("Почти");
  });
  it("после очистки поля маска возвращается прежней", async () => {
    const host = await showSpelling(wordItem({ greek: "σπίτι" }));
    await type(host, "σπ");
    await type(host, "");
    expect(shown(host)).toBe("σ____");
  });
  it("после сохранённого ответа маски нет, а написание раскрыто", async () => {
    const host = await showSpelling(wordItem({ greek: "σπίτι" }));
    await type(host, "σπίτι");
    await press(button(host, "Проверить"));
    expect(mask(host)).toBeNull();
    expect(note(host)).toBeUndefined();
    expect(host.querySelector('[data-testid="reveal"]')!.textContent).toContain("σπίτι");
    expect(answers).toBe(1);
  });
  it("ответ из одной буквы её не открывает и склоняется в подписи", async () => {
    const host = await showSpelling(wordItem({ greek: "ή", russian: "или" }));
    expect(shown(host)).toBe("_");
    expect(note(host)).toBe("Ответ из 1 буквы");
  });
  it("сборка из слогов маски не показывает", async () => {
    const host = await show(<Assembly item={assemblyItem()} onAnswer={onAnswer} onNext={() => undefined} />);
    expect(host.querySelectorAll('[data-testid="tile"]').length).toBeGreaterThan(1);
    expect(mask(host)).toBeNull();
  });
});
