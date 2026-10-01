// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { launchContext, resetLaunchContext, type LaunchContext } from "../src/platform/launch";
import { MOCK_USER, ownerMatches, parseMockUser, profileFor, type Profile } from "../src/storage/profile";

const telegram = (id: number | null, bot = "tetradio_local"): LaunchContext => ({
  kind: "telegram",
  bot,
  platform: "ios",
  version: "8.0",
  user: id === null ? null : { id, firstName: "A" },
  startParam: null,
  launchId: null,
});
const web: LaunchContext = { ...telegram(null), kind: "web", platform: null, version: null };
const owner = (context: LaunchContext, mock: number | null = null): Profile => {
  const profile = profileFor(context, mock);
  if (profile.kind === "blocked") throw new Error(profile.reason);
  return profile;
};

describe("владелец локальных данных", () => {
  it("разные аккаунты и боты получают разные базы `tetradio-tg-<bot>-<id>`, все синхронизируются", () => {
    const names = [owner(telegram(1)), owner(telegram(2)), owner(telegram(1, "tetradio_dev"))].map((p) => {
      expect(p).toMatchObject({ kind: "telegram", syncable: true });
      return p.databaseName;
    });
    expect(names).toEqual([
      "tetradio-tg-tetradio_local-1",
      "tetradio-tg-tetradio_local-2",
      "tetradio-tg-tetradio_dev-1",
    ]);
  });
  it("вне Telegram без мока запуск остановлен: ни базы, ни фиктивного аккаунта", () => {
    expect(profileFor(web, null)).toEqual({ kind: "blocked", reason: "outside-telegram", bot: "tetradio_local" });
  });
  it("Telegram без пользователя или с неопределимым ID — ошибка запуска, в том числе в сборке с моком", () => {
    for (const mock of [null, 1]) {
      expect(profileFor(telegram(null), mock)).toMatchObject({ kind: "blocked", reason: "no-user" });
      for (const id of [0, -5, 1.5, Number.MAX_SAFE_INTEGER + 2])
        expect(profileFor(telegram(id), mock)).toMatchObject({ kind: "blocked", reason: "no-user" });
    }
  });
  it("мок вне Telegram — отдельная база `tetradio-mock-<id>` без облака; Telegram-запуск в той же сборке — настоящий", () => {
    expect(owner(web, 7)).toMatchObject({ kind: "mock", userId: 7, databaseName: "tetradio-mock-7", syncable: false });
    expect(owner(telegram(7), 7).databaseName).toBe("tetradio-tg-tetradio_local-7");
  });
  it("флаг мока: только положительное целое; пустой и прочие значения мок не включают", () => {
    expect(parseMockUser("1")).toBe(1);
    expect(parseMockUser(" 42 ")).toBe(42);
    for (const raw of [undefined, "", "0", "true", "-1", "1e3", "abc"]) expect(parseMockUser(raw)).toBeNull();
    expect(MOCK_USER).toBe(1); // unit-тесты собраны с VITE_TELEGRAM_MOCK=1 (vite.config.ts)
  });
  it("пользователь bridge, отличный от владельца базы, опровергает владельца; отсутствующий — нет", () => {
    const a = owner(telegram(1));
    expect(ownerMatches(a, 1)).toBe(true);
    expect(ownerMatches(a, undefined)).toBe(true);
    expect(ownerMatches(a, 2)).toBe(false);
    expect(ownerMatches(owner(web, 1), 99)).toBe(true); // мок не сверяется с bridge
  });
});

describe("смена аккаунта в одной вкладке", () => {
  const initData = (id: number) =>
    encodeURIComponent(`user=${encodeURIComponent(JSON.stringify({ id, first_name: "A" }))}&auth_date=1&hash=x`);
  const open = (hash: string) => {
    window.history.replaceState(null, "", `/${hash}`);
    resetLaunchContext();
    return profileFor(launchContext(), null);
  };
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    resetLaunchContext();
  });
  it("A, затем B: новый запуск заменяет сохранённый контекст, перезагрузка остаётся B; запуск без пользователя не возвращает A", () => {
    expect(open(`#tgWebAppPlatform=ios&tgWebAppData=${initData(1)}`)).toMatchObject({
      databaseName: "tetradio-tg-tetradio_local-1",
    });
    expect(open(`#tgWebAppPlatform=ios&tgWebAppData=${initData(2)}`)).toMatchObject({
      databaseName: "tetradio-tg-tetradio_local-2",
    });
    expect(open("")).toMatchObject({ databaseName: "tetradio-tg-tetradio_local-2" });
    expect(open(`#tgWebAppPlatform=ios&tgWebAppData=${encodeURIComponent("auth_date=1&hash=x")}`)).toMatchObject({
      kind: "blocked",
      reason: "no-user",
    });
    expect(open("")).toMatchObject({ kind: "blocked", reason: "no-user" }); // перезагрузка не восстанавливает A
  });
  it("повреждённая запись вкладки не даёт владельца", () => {
    sessionStorage.setItem(
      "tetradio:launch",
      JSON.stringify({ kind: "telegram", bot: "tetradio_local", user: { id: "1" } }),
    );
    expect(open("")).toMatchObject({ kind: "blocked", reason: "no-user" });
  });
});

describe("база без владельца", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it("production вне Telegram: база не открывается и не создаётся даже при случайном запросе", async () => {
    vi.stubEnv("VITE_TELEGRAM_MOCK", "");
    vi.resetModules();
    const { db } = await import("../src/storage/db");
    await expect(db.meta.count()).rejects.toMatchObject({ name: "DatabaseClosedError" });
    expect(db.isOpen()).toBe(false);
    expect((await indexedDB.databases()).map((info) => info.name)).not.toContain(db.name);
  });
});
