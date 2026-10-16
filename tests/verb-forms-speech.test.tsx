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

const render = (headword: string, forms: string, onSay?: (form: string) => void) => {
  act(() => root.render(<VerbForms headword={headword} forms={forms} labels={false} headwordShown onSay={onSay} />));
  return host;
};
const heard = (node: Element) => {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll("[aria-hidden]").forEach((hidden) => hidden.remove());
  return copy.textContent!.replace(/\s+/g, " ").trim();
};
const seen = (node: Element) => {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll(".sr-only").forEach((hidden) => hidden.remove());
  return copy.textContent!;
};
const greek = (node: Element) =>
  [...node.querySelectorAll("[lang=el]")]
    .filter((el) => !el.closest("[aria-hidden]"))
    .map((el) => el.textContent!.trim());

describe("формы в строке словарика на слух", () => {
  it("мн. звучит словом по-русски, греческая часть размечена lang", () => {
    const node = render("η χώρα", "мн. οι χώρες");
    expect(heard(node)).toBe(", множественное число οι χώρες");
    expect(seen(node)).toBe("мн. οι χώρες");
    expect(greek(node)).toEqual(["οι χώρες"]);
  });
  it("прилагательное не повторяет заглавное слово", () => {
    const node = render("άσχημος", "άσχημος, άσχημη, άσχημο");
    expect(heard(node)).toBe(", άσχημη, άσχημο");
    expect(seen(node)).toBe("άσχημος, άσχημη, άσχημο");
    expect(greek(node)).toEqual(["άσχημη, άσχημο"]);
  });
  it("прочерк вместо форм молчит", () => {
    expect(heard(render("γεια", "—"))).toBe("");
  });
  it("глагол: без заглавной формы, с подписями времён, видимый ряд прежний", () => {
    const node = render("είμαι", "прош. ήμουν; буд. θα είμαι");
    expect(heard(node)).toBe(", было ήμουν, будет θα είμαι");
    expect(seen(node)).toBe("είμαι→ήμουν→θα είμαι");
    expect(greek(node)).toEqual(["ήμουν", "θα είμαι"]);
  });
  it("кнопку формы не прячет: заглавная форма с кнопкой остаётся доступной", () => {
    const node = render("είμαι", "прош. ήμουν; буд. θα είμαι", () => {});
    expect(node.querySelectorAll("button")).toHaveLength(3);
    expect(node.querySelector("[aria-hidden] button")).toBeNull();
  });
});
