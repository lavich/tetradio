// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ExerciseBlock, SpeakingBlock, WritingBlock } from "../src/content/course";
import { Exercise, Speaking, Writing } from "../src/features/course/blocks";
import type { BlockPatch } from "../src/storage/course";
import type { BlockProgress } from "../src/domain/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const writing: WritingBlock = {
  type: "writing",
  id: "letter",
  register: "friendly",
  prompt: "Напишите другу.",
  words: { min: 3, max: 50 },
  model: "Γεια σου!",
  criteria: ["Есть приветствие"],
};
const exercise: ExerciseBlock = {
  type: "exercise",
  id: "forms",
  instruction: "Выберите форму.",
  format: "choice",
  items: [{ id: "q1", prompt: "Εγώ ___", options: ["είμαι", "είσαι"], answer: ["είμαι"] }],
};
const speaking: SpeakingBlock = {
  type: "speaking",
  id: "talk",
  part: "monologue",
  prompt: "Расскажите о себе.",
  seconds: 30,
  criteria: ["Говорю без пауз"],
};

// eslint-disable-next-line typescript/unbound-method -- статический метод URL, присваивается обратно как есть
const createObjectURL = URL.createObjectURL;
let host: HTMLDivElement, root: Root;
let saved: BlockPatch[];
let failing: boolean;
const save = async (patch: BlockPatch) => {
  if (failing) throw new Error("QuotaExceededError");
  saved.push(patch);
};
beforeEach(() => {
  saved = [];
  failing = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  URL.createObjectURL = createObjectURL;
});

const type = (text: string) =>
  act(async () => {
    const area = host.querySelector("textarea")!;
    // eslint-disable-next-line typescript/unbound-method -- сеттер прототипа вызывается через .call, привязка задаётся явно
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
const press = (text: string) =>
  act(async () => {
    Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes(text))!
      .click();
  });
const alert = () => host.querySelector('[role="alert"]')?.textContent;

describe("письмо: черновик не теряется при закрытии", () => {
  it("сохраняется после паузы в наборе, одной записью", async () => {
    vi.useFakeTimers();
    act(() => root.render(<Writing block={writing} progress={undefined} save={save} />));
    await type("Γεια");
    await type("Γεια σου");
    expect(saved).toEqual([]);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(saved).toEqual([{ text: "Γεια σου", quiet: true }]);
  });
  it("тихая запись по паузе повторяется с объявлением при потере фокуса и не дублируется", async () => {
    vi.useFakeTimers();
    act(() => root.render(<Writing block={writing} progress={undefined} save={save} />));
    await type("Γεια σου");
    await act(async () => vi.advanceTimersByTime(2000));
    expect(saved).toEqual([{ text: "Γεια σου", quiet: true }]);
    await act(async () => host.querySelector("textarea")!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(saved).toEqual([{ text: "Γεια σου", quiet: true }, { text: "Γεια σου" }]);
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(saved).toHaveLength(2);
  });
  it("уход страницы в фон и размонтирование пишут черновик сразу", async () => {
    vi.useFakeTimers();
    act(() => root.render(<Writing block={writing} progress={undefined} save={save} />));
    await type("Γεια");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(saved).toEqual([{ text: "Γεια" }]);
    await type("Γεια σου");
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(saved).toEqual([{ text: "Γεια" }, { text: "Γεια σου" }]);
    await type("Γεια σου φίλε");
    act(() => root.render(<p />));
    expect(saved.at(-1)).toEqual({ text: "Γεια σου φίλε" });
    await act(async () => vi.advanceTimersByTime(2000));
    expect(saved).toHaveLength(3);
  });
  it("сбой записи показывает жалобу", async () => {
    failing = true;
    act(() => root.render(<Writing block={writing} progress={undefined} save={save} />));
    await type("Γεια σου φίλε");
    await press("Сравнить с образцом");
    expect(alert()).toBe("Не удалось сохранить. Проверьте место на устройстве и повторите.");
  });
});

describe("задание: проверка без записи не засчитывается", () => {
  it("при сбое кнопка «Проверить» остаётся, появляется жалоба", async () => {
    failing = true;
    act(() => root.render(<Exercise block={exercise} progress={undefined} save={save} />));
    await press("είμαι");
    await press("Проверить");
    expect(alert()).toBe("Не удалось сохранить. Проверьте место на устройстве и повторите.");
    expect(host.querySelector('[role="status"]')).toBeNull();
    failing = false;
    await press("Проверить");
    expect(alert()).toBeUndefined();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("1 из 1");
  });
});

describe("речь: микрофон не остаётся включённым", () => {
  const microphone = () => {
    const track = { stop: vi.fn() };
    let grant: (stream: MediaStream) => void = () => undefined;
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: () => new Promise<MediaStream>((resolve) => (grant = resolve)),
      },
    });
    vi.stubGlobal(
      "MediaRecorder",
      class {
        start = vi.fn();
        stop = vi.fn();
      },
    );
    return { track, grant: () => grant({ getTracks: () => [track] } as unknown as MediaStream) };
  };
  it("доступ дан после «Закончить» — дорожки сразу останавливаются", async () => {
    const mic = microphone();
    act(() => root.render(<Speaking block={speaking} progress={undefined} save={save} />));
    await press("Начать");
    await press("Закончить");
    await act(async () => mic.grant());
    expect(mic.track.stop).toHaveBeenCalled();
  });
  it("доступ дан после ухода с урока — дорожки сразу останавливаются", async () => {
    const mic = microphone();
    act(() => root.render(<Speaking block={speaking} progress={undefined} save={save} />));
    await press("Начать");
    act(() => root.render(<p />));
    await act(async () => mic.grant());
    expect(mic.track.stop).toHaveBeenCalled();
  });
  it("уход с урока во время записи останавливает дорожки", async () => {
    const mic = microphone();
    act(() => root.render(<Speaking block={speaking} progress={undefined} save={save} />));
    await press("Начать");
    await act(async () => mic.grant());
    expect(mic.track.stop).not.toHaveBeenCalled();
    act(() => root.render(<p />));
    expect(mic.track.stop).toHaveBeenCalled();
  });
  it("onstop после ухода с урока не создаёт адрес записи, который некому освободить", async () => {
    const track = { stop: vi.fn() };
    const recorders: { onstop?: () => void }[] = [];
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [track] } as unknown as MediaStream) },
    });
    vi.stubGlobal(
      "MediaRecorder",
      class {
        mimeType = "audio/webm";
        onstop?: () => void;
        start = vi.fn();
        stop = vi.fn();
        constructor() {
          recorders.push(this);
        }
      },
    );
    const create = vi.fn(() => "blob:recording");
    URL.createObjectURL = create;
    act(() => root.render(<Speaking block={speaking} progress={undefined} save={save} />));
    await press("Начать");
    await act(async () => {
      await Promise.resolve();
    });
    act(() => root.render(<p />));
    recorders[0].onstop?.();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("задание: выполнение, пришедшее синхронизацией", () => {
  const done: BlockProgress = {
    key: "l/forms",
    lessonId: "l",
    blockId: "forms",
    done: true,
    score: { correct: 1, almost: 0, total: 1 },
    updatedAt: "",
  };
  it("пустое задание показывает результат без переоткрытия", async () => {
    act(() => root.render(<Exercise block={exercise} progress={undefined} save={save} />));
    expect(host.querySelector('[role="status"]')).toBeNull();
    act(() => root.render(<Exercise block={exercise} progress={done} save={save} />));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("1 из 1 · на другом устройстве");
  });
  it("начатые ответы остаются, результат не подменяет их", async () => {
    act(() => root.render(<Exercise block={exercise} progress={undefined} save={save} />));
    await press("είμαι");
    act(() => root.render(<Exercise block={exercise} progress={done} save={save} />));
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
  it("после «Ещё раз» прежний результат не возвращается", async () => {
    act(() => root.render(<Exercise block={exercise} progress={undefined} save={save} />));
    await press("είμαι");
    await press("Проверить");
    act(() => root.render(<Exercise block={exercise} progress={done} save={save} />));
    await press("Ещё раз");
    expect(host.querySelector('[role="status"]')).toBeNull();
    act(() => root.render(<Exercise block={exercise} progress={{ ...done, done: false }} save={save} />));
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
