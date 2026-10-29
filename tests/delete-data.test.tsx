// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TelegramWebApp } from "../src/platform/telegram-types";

const env = vi.hoisted(() => {
  vi.stubEnv("VITE_TELEGRAM_BOT", "TetradioBot");
  return { bridge: null as TelegramWebApp | null, transfers: 0 };
});
vi.mock("../src/platform/platform", async (original) => ({
  ...(await original<typeof import("../src/platform/platform")>()),
  telegramBridge: () => env.bridge,
}));
vi.mock("../src/storage/profile", async (original) => ({
  ...(await original<typeof import("../src/storage/profile")>()),
  currentProfile: () => ({ kind: "telegram", userId: 7, bot: "TetradioBot" }),
}));
vi.mock("../src/features/backup/backup", async (original) => ({
  ...(await original<typeof import("../src/features/backup/backup")>()),
  exportFull: async () => new Blob(["{}"]),
  transferFile: async () => {
    env.transfers++;
    return "shared";
  },
}));

import { DeleteData } from "../src/features/backup/DeleteData";
import { EraseFailure } from "../src/storage/erase";
import { resetLaunchContext } from "../src/platform/launch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLElement;

beforeEach(() => {
  window.location.hash = `#tgWebAppPlatform=ios&tgWebAppData=${encodeURIComponent(`user=${JSON.stringify({ id: 7 })}`)}`;
  resetLaunchContext();
  vi.stubEnv("VITE_FEEDBACK_URL", "https://bot.example.workers.dev/feedback");
  env.bridge = { initData: "user=x&hash=y" } as unknown as TelegramWebApp;
  env.transfers = 0;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  window.location.hash = "";
  sessionStorage.clear();
  resetLaunchContext();
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_TELEGRAM_BOT", "TetradioBot");
});

const button = (name: string) =>
  [...document.querySelectorAll("button")].find((item) => item.textContent === name) as HTMLButtonElement | undefined;
async function settle() {
  for (let i = 0; i < 10; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function openDialog(erase: (withMessages: boolean) => Promise<void> = async () => undefined) {
  act(() => root.render(<DeleteData erase={erase} />));
  await act(async () => button("Удалить мои данные…")!.click());
  await settle();
}

describe("раздел «Удаление данных»", () => {
  it("текст раздела и диалог с перечнем и предупреждениями", async () => {
    await openDialog();
    expect(host.textContent).toContain("Удаляет прогресс, слова и настройки на этом устройстве и в облаке Telegram.");
    const dialog = document.body.textContent!;
    expect(dialog).toContain("Удалить все данные?");
    expect(dialog).toContain(
      "На других устройствах удаление нужно повторить — иначе они снова сохранят прогресс в облако.",
    );
    expect(dialog).toContain("Отчёты об ошибках после удаления снова включатся.");
    expect(dialog).toContain("Сообщения в вашем чате с ботом удаляете вы сами.");
    expect(dialog).toContain("И переписку с автором");
    expect(dialog).toContain("Заявки на курсы в работе.");
  });

  it("без формы обратной связи галочки нет", async () => {
    vi.stubEnv("VITE_FEEDBACK_URL", "");
    await openDialog();
    expect(document.body.textContent).not.toContain("И переписку с автором");
    expect(document.body.textContent).not.toContain("Заявки на курсы в работе.");
  });

  it("по умолчанию галочка выключена", async () => {
    const erase = vi.fn(async () => undefined);
    await openDialog(erase);
    await act(async () => button("Удалить")!.click());
    expect(erase).toHaveBeenCalledWith(false);
  });

  it("с отмеченной галочкой удаляется и переписка", async () => {
    const erase = vi.fn(async () => undefined);
    await openDialog(erase);
    await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => button("Удалить")!.click());
    expect(erase).toHaveBeenCalledWith(true);
  });

  it("«Сначала сохранить копию» сохраняет копию и оставляет диалог открытым", async () => {
    await openDialog();
    await act(async () => button("Сначала сохранить копию")!.click());
    await settle();
    expect(env.transfers).toBe(1);
    expect(document.body.textContent).toContain("Удалить все данные?");
  });

  it("«Отмена» ничего не удаляет", async () => {
    const erase = vi.fn(async () => undefined);
    await openDialog(erase);
    await act(async () => button("Отмена")!.click());
    await settle();
    expect(erase).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Удалить все данные?");
  });

  it.each([
    [new EraseFailure("messages", false), "Не удалось удалить переписку. Попробуйте позже."],
    [new EraseFailure("stale", false), "Перезапустите приложение и повторите."],
    [
      new EraseFailure("cloud", true),
      "Не удалось удалить данные из облака Telegram. Проверьте сеть и попробуйте ещё раз. Переписка уже удалена.",
    ],
    [new EraseFailure("busy", false), "Синхронизацией занята другая вкладка — закройте её и повторите."],
  ])("ошибка %s — свой текст", async (failure, text) => {
    await openDialog(async () => {
      throw failure;
    });
    await act(async () => button("Удалить")!.click());
    await settle();
    expect(document.querySelector('[role="alert"]')!.textContent).toBe(text);
  });

  it("во время удаления кнопки недоступны и диалог не закрывается", async () => {
    let finish: () => void = () => undefined;
    await openDialog(() => new Promise<void>((resolve) => (finish = resolve)));
    await act(async () => button("Удалить")!.click());
    expect(button("Удалить")!.disabled).toBe(true);
    expect(button("Отмена")!.disabled).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.body.textContent).toContain("Удалить все данные?");
    await act(async () => finish());
  });
});
