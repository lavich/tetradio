// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VerbForms } from "../src/shared/VerbForms";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const render = (headword: string, forms: string) => {
  act(() => root.render(<VerbForms headword={headword} forms={forms} labels={false} headwordShown />));
  return host;
};
const heard = (node: Element) => {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll("[aria-hidden]").forEach((hidden) => hidden.remove());
  return copy.textContent!.replace(/\s+/g, " ").trim();
};
const greek = (node: Element) =>
  [...node.querySelectorAll("[lang=el]")]
    .filter((el) => !el.closest("[aria-hidden]"))
    .map((el) => el.textContent!.trim());

describe("формы в строке словарика на слух", () => {
  it("мн. звучит словом по-русски, греческая часть размечена lang", () => {
    const node = render("η χώρα", "мн. οι χώρες");
    expect(heard(node)).toBe("множественное οι χώρες");
    expect(greek(node)).toEqual(["οι χώρες"]);
  });
  it("прилагательное не повторяет заглавное слово", () => {
    const node = render("άσχημος", "άσχημος, άσχημη, άσχημο");
    expect(heard(node)).toBe("άσχημη, άσχημο");
    expect(greek(node)).toEqual(["άσχημη, άσχημο"]);
  });
  it("прочерк вместо форм молчит", () => {
    expect(heard(render("γεια", "—"))).toBe("");
  });
});
