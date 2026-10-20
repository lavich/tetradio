// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { autoUpdate } from "../src/app/auto-update";
import { useAction } from "../src/shared/action";

it("действие экрана держит автообновление, пока не завершится", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let action: ReturnType<typeof useAction> | null = null;
  function Probe() {
    action = useAction("ошибка");
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  let finish = () => {};
  let running: Promise<void> = Promise.resolve();
  act(() => {
    running = action!.run(() => new Promise<void>((resolve) => (finish = resolve)));
  });
  expect(autoUpdate.held()).toBe(true);
  await act(async () => {
    finish();
    await running;
  });
  expect(autoUpdate.held()).toBe(false);
  act(() => root.unmount());
});
