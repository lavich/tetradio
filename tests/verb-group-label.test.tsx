// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockMarks } from "../src/content/schema";
import type { LessonItem, SessionItem, VerbGroup, Word } from "../src/domain/types";
import type { TapCard } from "../src/storage/course";
import { db, indexWord } from "../src/storage/db";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
vi.mock("../src/shared/audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/audio")>()),
  playText: () => Promise.resolve("played"),
  playWord: () => Promise.resolve("played"),
}));

const { VerbGroupLabel } = await import("../src/shared/VerbGroupLabel");
const { WordForms } = await import("../src/shared/VerbForms");
const { Recognition } = await import("../src/features/learning/exercises/Recognition");
const { VocabularyList } = await import("../src/features/course/Vocabulary");
const { Marked, WordTaps } = await import("../src/features/course/WordTaps");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (node: React.ReactNode) => act(async () => root.render(node));
const label = () => host.querySelector("[data-testid=verb-group]");
const shown = (node: Element) => node.querySelector("[aria-hidden]")!.textContent;
const heard = (node: Element) => {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll("[aria-hidden]").forEach((hidden) => hidden.remove());
  return copy.textContent!.replace(/\s+/g, " ").trim();
};
const greekIn = (node: Element) => [...node.querySelectorAll("[lang=el]")].map((el) => el.textContent);

const verb = (fields: Partial<Word> = {}): Word => ({
  id: "w-come",
  greek: "έρχομαι",
  russian: "приходить",
  ipa: "",
  forms: "аор. ήρθα; буд. θα έρθω",
  paradigm: {
    present: ["έρχομαι", "έρχεσαι", "έρχεται", "ερχόμαστε", "έρχεστε", "έρχονται"],
    past: ["ήρθα", "ήρθες", "ήρθε", "ήρθαμε", "ήρθατε", "ήρθαν"],
  },
  group: "mid",
  irregular: true,
  segments: [],
  examples: [],
  verified: true,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  ...fields,
});

describe("текст метки", () => {
  it.each<{ group: VerbGroup; irregular?: true; seen: string; spoken: string; greek: string[] }>([
    { group: "A", seen: "гр. A", spoken: "группа A", greek: [] },
    { group: "B1", seen: "гр. B как αγαπάω", spoken: "группа B, как αγαπάω", greek: ["αγαπάω", "αγαπάω"] },
    { group: "B2", seen: "гр. B как μπορώ", spoken: "группа B, как μπορώ", greek: ["μπορώ", "μπορώ"] },
    {
      group: "B1",
      irregular: true,
      seen: "гр. B как αγαπάω · неправ. прош.",
      spoken: "группа B, как αγαπάω, неправильное прошедшее",
      greek: ["αγαπάω", "αγαπάω"],
    },
    { group: "mid", seen: "на -μαι", spoken: "глагол на -μαι", greek: ["-μαι", "-μαι"] },
    {
      group: "A",
      irregular: true,
      seen: "гр. A · неправ. прош.",
      spoken: "группа A, неправильное прошедшее",
      greek: [],
    },
    {
      group: "mid",
      irregular: true,
      seen: "на -μαι · неправ. прош.",
      spoken: "глагол на -μαι, неправильное прошедшее",
      greek: ["-μαι", "-μαι"],
    },
    { group: "other", irregular: true, seen: "неправ. прош.", spoken: "неправильное прошедшее", greek: [] },
  ])("видно «$seen», диктор читает «$spoken»", async ({ group, irregular, seen, spoken, greek }) => {
    await render(<VerbGroupLabel group={group} irregular={irregular} />);
    expect(shown(label()!)).toBe(seen);
    expect(heard(label()!)).toBe(spoken);
    expect(greekIn(label()!)).toEqual(greek);
  });

  it("без группы ничего не рендерится", async () => {
    await render(<VerbGroupLabel />);
    expect(host.innerHTML).toBe("");
    await render(<VerbGroupLabel group="other" />);
    expect(host.innerHTML).toBe("");
  });
});

describe("где видна метка", () => {
  it("в формах слова — перед рядом форм", async () => {
    await render(<WordForms word={verb()} />);
    const row = host.querySelector("[data-testid=verb-forms]")!;
    expect(label()!.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("у не-глагола метки нет", async () => {
    await render(<WordForms word={{ greek: "ο φίλος", forms: "мн. οι φίλοι" }} />);
    expect(label()).toBeNull();
  });

  it("в узнавании — только после ответа", async () => {
    const word = verb();
    const item: SessionItem = {
      id: "i-recognition",
      ref: { kind: "word", id: word.id },
      unitKey: `word:${word.id}`,
      card: { kind: "word", word },
      type: "recognition",
      options: ["приходить", "уходить", "видеть", "жить"],
      isNew: false,
      mode: "practice",
      expectedVersion: 0,
    };
    await render(<Recognition item={item} onAnswer={async () => true} onNext={() => undefined} />);
    expect(label()).toBeNull();
    const correct = [...host.querySelectorAll("button")].find((button) => button.textContent === "приходить")!;
    await act(async () => correct.click());
    expect(label()).not.toBeNull();
  });

  it("в списке слов урока — у глагола, после слова и до форм в имени строки", async () => {
    await db.words.clear();
    await db.words.bulkPut([
      indexWord(verb()),
      indexWord({
        ...verb({ id: "w-friend", greek: "ο φίλος", russian: "друг", forms: "мн. οι φίλοι" }),
        paradigm: undefined,
        group: undefined,
        irregular: undefined,
      }),
    ]);
    const items = ["w-come", "w-friend"].map((id, position): LessonItem => ({
      lessonId: "l",
      unitKey: id,
      ref: { kind: "word", id },
      position,
    }));
    await render(<VocabularyList items={items} />);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    const [come, friend] = [...host.querySelectorAll("button")];
    expect(come.querySelector("[data-testid=verb-group]")).not.toBeNull();
    expect(friend.querySelector("[data-testid=verb-group]")).toBeNull();
    expect(heard(come)).toMatch(/^Произнести: έρχομαι, глагол на -μαι, неправильное прошедшее, было ήρθα/);
    expect(heard(come)).toMatch(/приходить$/);
  });

  it.each([
    ["с формами", "аор. ήρθα; буд. θα έρθω"],
    ["с формой без греческих букв", "—"],
  ])("в подсказке по нажатию %s", async (_, forms) => {
    const card: TapCard = { ref: "w", greek: "έρχομαι", russian: "приходить", forms, group: "mid", irregular: true };
    const marks: BlockMarks = { b: { text: [{ start: 0, length: 7, ref: "w", kind: "lesson", first: false }] } };
    await render(
      <WordTaps marks={marks} cards={new Map([["w", card]])} page={0}>
        <p>
          <Marked text="έρχομαι" marks={marks.b.text} />
        </p>
      </WordTaps>,
    );
    await act(async () => host.querySelector<HTMLElement>("[role=button][aria-haspopup]")!.click());
    const sheet = document.querySelector("[role=dialog]")!;
    expect(shown(sheet.querySelector("[data-testid=verb-group]")!)).toBe("на -μαι · неправ. прош.");
  });
});
