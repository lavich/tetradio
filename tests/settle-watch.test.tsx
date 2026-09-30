// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSettleWatch } from "../src/app/settle-watch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
const calls: string[] = [];
function Watcher({ now }: { now: Date }) {
  useSettleWatch(now, "Asia/Nicosia", () => calls.push(now.toISOString()));
  return null;
}
const at = (iso: string) => act(() => root.render(<Watcher now={new Date(iso)} />));

beforeEach(() => {
  calls.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("не закрепляет на первом рендере: это уже сделал запуск приложения", () => {
  at("2026-09-15T06:00:00Z");
  expect(calls).toEqual([]);
});
it("закрепляет при смене местного часа", () => {
  at("2026-09-15T06:00:00Z"); // 09:00
  at("2026-09-15T06:59:00Z"); // тот же час
  expect(calls).toEqual([]);
  at("2026-09-15T07:01:00Z"); // 10:00
  expect(calls).toEqual(["2026-09-15T07:01:00.000Z"]);
});
it("закрепляет при смене календарного дня", () => {
  at("2026-09-15T20:30:00Z"); // 23:30 по Никосии
  at("2026-09-15T21:30:00Z"); // 00:30 следующего дня
  expect(calls).toEqual(["2026-09-15T21:30:00.000Z"]);
});
it("минуты внутри часа закрепление не запускают", () => {
  at("2026-09-15T06:00:00Z");
  for (const minute of ["06:10", "06:20", "06:59"]) at(`2026-09-15T${minute}:00Z`);
  expect(calls).toEqual([]);
});
