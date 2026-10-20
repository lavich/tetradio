import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindInteractions, createAutoUpdater, type AutoUpdatePorts } from "../src/app/auto-update";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};
function fakeRegistration(found: boolean) {
  const waiting = { postMessage: vi.fn() };
  const registration = {
    waiting: null as typeof waiting | null,
    installing: null,
    update: vi.fn(async () => {
      if (found) registration.waiting = waiting;
    }),
  };
  return { registration, waiting };
}
function setup(overrides: Partial<AutoUpdatePorts> = {}) {
  const container = new EventTarget();
  const reload = vi.fn();
  const markReload = vi.fn();
  const dismissNotice = vi.fn();
  let busy = false;
  const updater = createAutoUpdater({
    container,
    storage: memoryStorage(),
    build: "b1",
    reload,
    markReload,
    dismissNotice,
    busy: () => busy,
    now: () => Date.now(),
    schedule: (run, ms) => {
      const id = setTimeout(run, ms);
      return () => clearTimeout(id);
    },
    ...overrides,
  });
  return { updater, container, reload, markReload, dismissNotice, setBusy: (value: boolean) => (busy = value) };
}
const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("автообновление при облаке новее приложения", () => {
  it("во время занятия не перезагружает; на «Сегодня» после 3 с без касаний — одна перезагрузка", async () => {
    const { updater, container, reload } = setup();
    const { registration, waiting } = fakeRegistration(true);
    updater.route("/session");
    updater.registered(registration);
    updater.request();
    expect(updater.state()).toBe("updating");
    await settle(10_000);
    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(waiting.postMessage).not.toHaveBeenCalled();
    updater.route("/");
    await settle(1000);
    updater.interacted();
    await settle(2000);
    expect(waiting.postMessage).not.toHaveBeenCalled();
    await settle(2000);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("на «Настройках» не перезагружает даже без касаний", async () => {
    const { updater } = setup();
    const { registration, waiting } = fakeRegistration(true);
    updater.registered(registration);
    updater.route("/progress/settings");
    updater.request();
    await settle(60_000);
    expect(waiting.postMessage).not.toHaveBeenCalled();
  });
  it("открытое окно или поле в фокусе откладывают перезагрузку", async () => {
    const { updater, setBusy } = setup();
    const { registration, waiting } = fakeRegistration(true);
    updater.registered(registration);
    updater.route("/");
    setBusy(true);
    updater.request();
    await settle(30_000);
    expect(waiting.postMessage).not.toHaveBeenCalled();
    setBusy(false);
    await settle(4000);
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
  });
  it("возврат в приложение — повод перепроверить, но после него снова нужна пауза", async () => {
    const { updater } = setup();
    const { registration, waiting } = fakeRegistration(true);
    updater.registered(registration);
    updater.route("/");
    updater.request();
    await settle(2000);
    updater.visible();
    await settle(2000);
    expect(waiting.postMessage).not.toHaveBeenCalled();
    await settle(2000);
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
  });
  it("колбэк до регистрации service worker обрабатывается после неё", async () => {
    const { updater } = setup();
    const { registration, waiting } = fakeRegistration(true);
    updater.route("/");
    updater.request();
    await settle(5000);
    updater.registered(registration);
    await settle(4000);
    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
  });
  it("новая сборка, ждавшая до отметки, применяется сразу и закрывает уведомление", async () => {
    const { updater, dismissNotice } = setup();
    const { registration, waiting } = fakeRegistration(false);
    registration.waiting = waiting;
    updater.registered(registration);
    expect(updater.needRefresh()).toBe(false);
    updater.route("/");
    updater.request();
    expect(dismissNotice).toHaveBeenCalledTimes(1);
    await settle(4000);
    expect(registration.update).not.toHaveBeenCalled();
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
  });
  it("двойной onNeedRefresh не даёт двойного применения", async () => {
    const { updater, container, reload } = setup();
    const { registration, waiting } = fakeRegistration(true);
    updater.registered(registration);
    updater.route("/");
    updater.request();
    expect(updater.needRefresh()).toBe(true);
    expect(updater.needRefresh()).toBe(true);
    await settle(10_000);
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("без отметки новая сборка показывает прежнее уведомление", () => {
    const { updater } = setup();
    expect(updater.needRefresh()).toBe(false);
    expect(updater.state()).toBe("idle");
  });
  it("новой сборки нет — прежний статус «Перезапустите приложение», перезагрузки нет", async () => {
    const { updater, reload } = setup();
    const { registration } = fakeRegistration(false);
    updater.registered(registration);
    updater.route("/");
    updater.request();
    await settle(10_000);
    expect(updater.state()).toBe("none");
    expect(reload).not.toHaveBeenCalled();
  });
  it("без service worker — одна перезагрузка на сборку", async () => {
    const storage = memoryStorage();
    const first = setup({ container: null, storage });
    first.updater.route("/");
    first.updater.request();
    await settle(4000);
    expect(first.reload).toHaveBeenCalledTimes(1);
    const second = setup({ container: null, storage });
    second.updater.route("/");
    second.updater.request();
    await settle(10_000);
    expect(second.reload).not.toHaveBeenCalled();
    expect(second.updater.state()).toBe("none");
    const next = setup({ container: null, storage, build: "b2" });
    next.updater.route("/");
    next.updater.request();
    await settle(4000);
    expect(next.reload).toHaveBeenCalledTimes(1);
  });
  it("регистрация не удалась — путь без service worker", async () => {
    const { updater, reload } = setup();
    updater.route("/");
    updater.request();
    updater.registerFailed();
    await settle(4000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("установка новой сборки сорвалась — «Перезапустите приложение» вместо вечного «Обновляем…»", async () => {
    const { updater, reload } = setup();
    const installing = Object.assign(new EventTarget(), { state: "installing" });
    const registration = {
      waiting: null,
      installing: null as typeof installing | null,
      update: vi.fn(async () => {
        registration.installing = installing;
      }),
    };
    updater.registered(registration);
    updater.route("/");
    updater.request();
    await settle(1000);
    expect(updater.state()).toBe("updating");
    installing.state = "redundant";
    installing.dispatchEvent(new Event("statechange"));
    expect(updater.state()).toBe("none");
    await settle(10_000);
    expect(reload).not.toHaveBeenCalled();
  });
  it("сборка без регистрации service worker (разработка) — сразу «Перезапустите приложение»", async () => {
    const { updater, reload } = setup();
    updater.unsupported();
    updater.route("/");
    updater.request();
    expect(updater.state()).toBe("none");
    await settle(10_000);
    expect(reload).not.toHaveBeenCalled();
  });
  it("перед применением путь запуска помечается использованным: перезагрузка не откроет слово из ссылки снова", async () => {
    const withWorker = setup();
    const { registration, waiting } = fakeRegistration(true);
    withWorker.updater.registered(registration);
    withWorker.updater.route("/");
    withWorker.updater.request();
    await settle(4000);
    expect(withWorker.markReload).toHaveBeenCalledTimes(1);
    expect(withWorker.markReload.mock.invocationCallOrder[0]).toBeLessThan(
      waiting.postMessage.mock.invocationCallOrder[0],
    );
    const without = setup({ container: null });
    without.updater.route("/");
    without.updater.request();
    await settle(4000);
    expect(without.markReload.mock.invocationCallOrder[0]).toBeLessThan(without.reload.mock.invocationCallOrder[0]);
  });
  it("незаконченная работа (загрузка курса, восстановление копии, окно передачи) откладывает перезагрузку", async () => {
    const { updater, reload } = setup({ container: null });
    let finish = () => {};
    const work = updater.hold(new Promise<void>((resolve) => (finish = resolve)));
    const failing = updater.hold(Promise.reject(new Error("отказ")));
    await expect(failing).rejects.toThrow("отказ");
    updater.route("/");
    updater.request();
    await settle(30_000);
    expect(reload).not.toHaveBeenCalled();
    finish();
    await work;
    await settle(4000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("без service worker после перезагрузки на этой сборке «Обновляем…» не мелькает", () => {
    const storage = memoryStorage();
    storage.setItem("tetradio:auto-update-build", "b1");
    const { updater } = setup({ container: null, storage });
    const states: string[] = [];
    updater.subscribe(() => states.push(updater.state()));
    updater.request();
    expect(states).toEqual(["none"]);
  });
});

it("колесо мыши, прокрутка и движение пальца считаются касанием", () => {
  const target = new EventTarget();
  const interacted = vi.fn();
  bindInteractions(target, { interacted });
  for (const type of ["pointerdown", "keydown", "wheel", "touchmove", "scroll"]) target.dispatchEvent(new Event(type));
  expect(interacted).toHaveBeenCalledTimes(5);
});
