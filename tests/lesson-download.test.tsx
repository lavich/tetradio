// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { setPhase } from "../src/content/phases";
import { ContentError } from "../src/content/schema";

const fake = vi.hoisted(() => ({
  frames: [] as string[],
  pending: [] as { lessonId: string; resolve: () => void; reject: (error: unknown) => void }[],
}));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => ({ missing: true, gone: false }) }));
vi.mock("react-router-dom", () => ({ Navigate: () => null }));
vi.mock("../src/app/Screen", () => ({
  Screen: ({ children }: { children?: ReactNode }) => {
    fake.frames.push(renderToStaticMarkup(<>{children}</>));
    return <>{children}</>;
  },
}));
vi.mock("../src/content/client", async (original) => ({
  ...(await original<object>()),
  installLesson: (lessonId: string) =>
    new Promise<void>((resolve, reject) => fake.pending.push({ lessonId, resolve, reject })),
}));

import { LessonDownload } from "../src/features/course/LessonDownload";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  fake.frames.length = 0;
  fake.pending.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const show = (lessonId: string, strict = false) => {
  const screen = <LessonDownload lessonId={lessonId} moduleId="m01" />;
  act(() => root.render(strict ? <StrictMode>{screen}</StrictMode> : screen));
};
const fail = async (index: number, message = "Нет сети.") => {
  await act(async () => fake.pending[index].reject(new ContentError(message, "network")));
};
const text = () => host.textContent;

describe("экран скачивания урока", () => {
  it("до результата своей попытки — «скачивается…», ни в одном кадре нет ошибки", async () => {
    setPhase("m01-2", { phase: "error", message: "Чужая ошибка.", kind: "network" });
    try {
      show("m01-2");
      expect(text()).toBe("Урок скачивается…");
      expect(fake.frames.join("")).not.toMatch(/Повторить|Чужая ошибка/);
    } finally {
      setPhase("m01-2", { phase: "idle" });
    }
  });

  it("сбой своей попытки показывает ошибку и «Повторить», повтор сразу возвращает «скачивается…»", async () => {
    show("m01-2");
    await fail(0);
    expect(text()).toContain("Нет сети.");
    fake.frames.length = 0;
    act(() => host.querySelector("button")!.click());
    expect(text()).toBe("Урок скачивается…");
    expect(fake.frames.join("")).not.toContain("Нет сети.");
    expect(fake.pending).toHaveLength(2);
    await fail(1, "Снова нет сети.");
    expect(text()).toContain("Снова нет сети.");
  });

  it("смена урока при открытой ошибке не показывает ошибку прежнего урока ни в одном кадре", async () => {
    show("m01-2");
    await fail(0);
    fake.frames.length = 0;
    show("m01-3");
    expect(fake.frames.join("")).not.toContain("Нет сети.");
    expect(text()).toBe("Урок скачивается…");
  });

  it("возврат к уроку с прежней ошибкой начинает новую попытку без неё", async () => {
    show("m01-2");
    await fail(0);
    show("m01-3");
    fake.frames.length = 0;
    show("m01-2");
    expect(fake.frames.join("")).not.toContain("Нет сети.");
    expect(text()).toBe("Урок скачивается…");
  });

  it("запоздалый сбой прежнего урока после смены не показывается", async () => {
    show("m01-2");
    show("m01-3");
    await fail(0, "Ошибка урока 2.");
    expect(text()).toBe("Урок скачивается…");
  });

  it("успех не показывает ошибку", async () => {
    show("m01-2");
    await act(async () => fake.pending[0].resolve());
    expect(fake.frames.join("")).not.toMatch(/Повторить/);
    expect(text()).toBe("Урок скачивается…");
  });

  it("StrictMode: сбой попытки показывается один раз, без второй ошибки и без необработанных отказов", async () => {
    show("m01-2", true);
    expect(fake.pending).toHaveLength(2);
    await fail(0);
    await fail(1);
    expect(text()).toContain("Нет сети.");
    expect(host.querySelectorAll("button")).toHaveLength(1);
  });
});
