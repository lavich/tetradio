// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Listening } from "../src/features/learning/exercises";
import type { Phrase, SessionItem, Word } from "../src/domain/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom не реализует прокрутку, а раскрытый ответ подводится к верху области.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;

const word = (over: Partial<Word> = {}): Word => ({
  id: "w1",
  greek: "το σπίτι",
  russian: "дом",
  ipa: "to ˈspiti",
  segments: [],
  examples: [{ greek: "Το σπίτι είναι μεγάλο.", russian: "Дом большой.", target: "σπίτι" }],
  verified: false,
  createdAt: "",
  updatedAt: "",
  ...over,
});
const phrase = (over: Partial<Phrase> = {}): Phrase => ({
  id: "p1",
  text: "Καλημέρα",
  translation: "Доброе утро",
  usage: "Приветствие до полудня",
  note: "Ударение на последнем слоге",
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
  type: "listening",
  options: ["το σπίτι", "η πόρτα", "το νερό", "ο δρόμος"],
  isNew: false,
  mode: "scheduled",
  expectedVersion: 1,
});
const phraseItem = (over: Partial<Phrase> = {}): SessionItem => ({
  id: "i2",
  ref: { kind: "phrase", id: "p1" },
  unitKey: "phrase:p1",
  card: { kind: "phrase", phrase: phrase(over) },
  type: "listening",
  options: ["Καλημέρα", "Καληνύχτα", "Ευχαριστώ", "Παρακαλώ"],
  isNew: false,
  mode: "scheduled",
  expectedVersion: 1,
});

let root: Root | null = null,
  container: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const show = async (item: SessionItem) => {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => {
    root!.render(<Listening item={item} onAnswer={async () => true} onNext={() => undefined} />);
  });
  return container;
};
const press = async (element: Element | undefined) => {
  await act(async () => {
    (element as HTMLElement).click();
  });
};
const option = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll('[data-testid="option"]')).find((button) => button.textContent?.includes(text));
const dontKnow = (host: HTMLElement) =>
  Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Не знаю");
const reveal = (host: HTMLElement) => host.querySelector('[data-testid="reveal"]');

describe("значение после ответа в аудировании", () => {
  it("после ошибки показывает перевод, IPA и пример", async () => {
    const host = await show(wordItem());
    await press(option(host, "η πόρτα"));
    const card = reveal(host);
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("дом");
    expect(card!.textContent).toContain("to ˈspiti");
    expect(card!.textContent).toContain("Дом большой.");
  });

  it("после верного ответа показывает то же самое", async () => {
    const host = await show(wordItem());
    await press(option(host, "το σπίτι"));
    expect(reveal(host)?.textContent).toContain("дом");
  });

  it("после «Не знаю» показывает то же самое", async () => {
    const host = await show(wordItem());
    await press(dontKnow(host));
    expect(reveal(host)?.textContent).toContain("дом");
  });

  it("до ответа значения не видно", async () => {
    const host = await show(wordItem());
    expect(reveal(host)).toBeNull();
    expect(host.textContent).not.toContain("дом");
  });

  it("у фразы показывает перевод, ситуацию и примечание", async () => {
    const host = await show(phraseItem());
    await press(option(host, "Ευχαριστώ"));
    const card = reveal(host);
    expect(card!.textContent).toContain("Доброе утро");
    expect(card!.textContent).toContain("Приветствие до полудня");
    expect(card!.textContent).toContain("Ударение на последнем слоге");
  });

  it("у материала без примера и заметок раскрытие остаётся с переводом", async () => {
    const host = await show(wordItem({ examples: [], ipa: "" }));
    await press(option(host, "το νερό"));
    expect(reveal(host)?.textContent).toContain("дом");
  });

  it("второй кнопки озвучки слова в раскрытии нет: сверху уже есть повтор аудио", async () => {
    const host = await show(wordItem());
    await press(option(host, "το σπίτι"));
    expect(reveal(host)!.querySelector('[aria-label="Послушать слово"],[aria-label="Озвучка недоступна"]')).toBeNull();
  });
});
