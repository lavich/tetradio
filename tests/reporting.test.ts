// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installEarlyHandlers,
  lifecycle,
  pendingReports,
  reportError,
  reportingEnabled,
  resetReporting,
  setReportingEnabled,
  type Sdk,
  type SdkOptions,
} from "../src/reporting/reporting";

const DSN = "https://key@o1.ingest.sentry.io/1";
function fakeSdk() {
  const calls: {
    init: SdkOptions[];
    capture: { error: unknown; id: string; category?: string; extra?: unknown; mechanism: string }[];
    crumbs: unknown[];
    closed: number;
  } = { init: [], capture: [], crumbs: [], closed: 0 };
  const sdk: Sdk = {
    init(options) {
      calls.init.push(options);
    },
    capture(error, hint) {
      calls.capture.push({ error, id: hint.id, category: hint.category, extra: hint.extra, mechanism: hint.mechanism });
    },
    breadcrumb(crumb) {
      calls.crumbs.push(crumb);
    },
    async close() {
      calls.closed++;
    },
  };
  return { sdk, calls };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Искусственное событие `error`: гасим его по умолчанию, чтобы Vitest не счёл его непойманным исключением теста. */
const raise = (message: string) =>
  window.dispatchEvent(new ErrorEvent("error", { error: new Error(message), message, cancelable: true }));
window.addEventListener("error", (event) => event.preventDefault());
afterEach(() => {
  resetReporting();
});

describe("модуль отчётов без адреса приёма", () => {
  it("reportError — пустая операция, динамический импорт не вызывается, ничего не буферизуется", async () => {
    const loader = vi.fn(async () => fakeSdk().sdk);
    resetReporting({ dsn: undefined, loader });
    installEarlyHandlers();
    expect(reportError(new Error("boom"), { category: "storage" })).toBeNull();
    setReportingEnabled(true);
    await flush();
    raise("early");
    expect(loader).not.toHaveBeenCalled();
    expect(pendingReports()).toHaveLength(0);
    expect(reportingEnabled()).toBe(false);
  });
});

describe("модуль отчётов с адресом приёма", () => {
  it("ранние ошибки копятся до десяти и уходят в SDK после включения в порядке появления; ранние крошки тоже", async () => {
    const { sdk, calls } = fakeSdk();
    const loader = vi.fn(async () => sdk);
    resetReporting({ dsn: DSN, loader });
    installEarlyHandlers();
    lifecycle("activated", { stableHeight: 600 });
    raise("early-0");
    const ids: string[] = [];
    for (let i = 1; i <= 12; i++)
      ids.push(reportError(new Error(`e-${i}`), { category: "content", extra: { packageId: "lesson-1-1" } })!);
    expect(ids.every((id) => /^[0-9a-f]{32}$/.test(id))).toBe(true);
    expect(pendingReports()).toHaveLength(10);
    expect(loader).not.toHaveBeenCalled(); // до чтения настройки SDK не загружается
    setReportingEnabled(true);
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(calls.init).toHaveLength(1);
    expect(calls.init[0].dsn).toBe(DSN);
    expect(calls.init[0].tags.env).toBe("web");
    expect(calls.init[0].tags["app.version"]).toBeTypeOf("string");
    expect(calls.crumbs).toEqual([{ category: "lexi.lifecycle", message: "activated", data: { stableHeight: 600 } }]);
    expect(calls.capture.map((entry) => (entry.error as Error).message)).toEqual([
      "early-0",
      "e-1",
      "e-2",
      "e-3",
      "e-4",
      "e-5",
      "e-6",
      "e-7",
      "e-8",
      "e-9",
    ]);
    expect(calls.capture[0].mechanism).toBe("onerror");
    expect(calls.capture[1]).toMatchObject({
      id: ids[0],
      category: "content",
      extra: { packageId: "lesson-1-1" },
      mechanism: "explicit",
    });
    expect(pendingReports()).toHaveLength(0);
    // После готовности SDK отчёт уходит сразу, свои глобальные обработчики сняты — их место занимает SDK.
    reportError(new Error("late"), { category: "sync" });
    raise("late-global");
    expect(calls.capture.map((entry) => (entry.error as Error).message)).toContain("late");
    expect(calls.capture.map((entry) => (entry.error as Error).message)).not.toContain("late-global");
    expect(reportingEnabled()).toBe(true);
  });
  it("выключение до загрузки очищает очередь и не загружает SDK; выключение после — закрывает SDK и чистит офлайн-очередь", async () => {
    const { sdk, calls } = fakeSdk();
    const loader = vi.fn(async () => sdk);
    resetReporting({ dsn: DSN, loader });
    reportError(new Error("early"));
    setReportingEnabled(false);
    await flush();
    expect(pendingReports()).toHaveLength(0);
    expect(loader).not.toHaveBeenCalled();
    expect(reportError(new Error("while-off"))).toBeNull();
    setReportingEnabled(true);
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(calls.capture).toHaveLength(0); // очищенная очередь не восстанавливается
    const deleted = vi.spyOn(indexedDB, "deleteDatabase");
    setReportingEnabled(false);
    await flush();
    expect(calls.closed).toBe(1);
    expect(deleted).toHaveBeenCalledWith("lexi-error-reports");
    expect(reportError(new Error("after-off"))).toBeNull();
    expect(calls.capture).toHaveLength(0);
    // Повторное включение поднимает SDK заново.
    setReportingEnabled(true);
    await flush();
    expect(calls.init).toHaveLength(2);
    expect(reportError(new Error("again"))).not.toBeNull();
    expect(calls.capture).toHaveLength(1);
  });
});

describe("привязка к настройке", () => {
  it("SDK поднимается только при включённой настройке и закрывается при выключении, без перезапуска", async () => {
    const { LexiDatabase } = await import("../src/storage/db");
    const { defaultSettings } = await import("../src/domain/types");
    const { bindReportingToSettings } = await import("../src/reporting/settings");
    const db = new LexiDatabase("lexi-reporting-settings");
    await db.delete();
    await db.open();
    await db.settings.put({ ...defaultSettings, errorReports: false });
    const { sdk, calls } = fakeSdk();
    const loader = vi.fn(async () => sdk);
    resetReporting({ dsn: DSN, loader });
    const unbind = bindReportingToSettings(db);
    await vi.waitFor(() => expect(reportError(new Error("off"))).toBeNull()); // первое значение живого запроса — выключено
    await flush();
    expect(loader).not.toHaveBeenCalled();
    expect(pendingReports()).toHaveLength(0);
    await db.settings.put({ ...defaultSettings, errorReports: true });
    await vi.waitFor(() => expect(calls.init).toHaveLength(1));
    expect(reportError(new Error("on"))).not.toBeNull();
    expect(calls.capture).toHaveLength(1);
    await db.settings.put({ ...defaultSettings, errorReports: false });
    await vi.waitFor(() => expect(calls.closed).toBe(1));
    expect(reportError(new Error("off-again"))).toBeNull();
    unbind();
    db.close();
  });
});
