// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LessonItem, Word } from "../src/domain/types";
import { db, indexWord } from "../src/storage/db";
import { VocabularyList } from "../src/features/course/Vocabulary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const word = (id: string, greek: string, russian: string): Word => ({
  id,
  greek,
  russian,
  ipa: "",
  segments: [],
  examples: [],
  verified: false,
  createdAt: "",
  updatedAt: "",
});
const item = (id: string, position: number): LessonItem => ({
  lessonId: "l",
  unitKey: "u",
  ref: { kind: "word", id },
  position,
});

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await db.words.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("скрытая запятая перед переводом — только когда перевод есть", async () => {
  await db.words.bulkPut([indexWord(word("w-water", "το νερό", "вода")), indexWord(word("w-bare", "ναι", ""))]);
  await act(async () => root.render(<VocabularyList items={[item("w-water", 0), item("w-bare", 1)]} />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  const names = [...host.querySelectorAll("button")].map((button) => button.textContent);
  expect(names).toEqual(["Произнести: το νερό, вода", "Произнести: ναι"]);
});
