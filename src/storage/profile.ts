import { launchContext, type LaunchContext } from "../platform/launch";

/**
 * Владелец локальных данных — пара «бот + Telegram-пользователь», у каждой своя база. Telegram ID здесь лишь
 * локальный селектор, а не серверное доказательство личности; облачную область задаёт сам Telegram.
 * Без владельца запуск останавливается до открытия базы; исключение — сборка с `VITE_TELEGRAM_MOCK=<id>` вне Telegram.
 */
export interface Profile {
  kind: "telegram" | "mock";
  bot: string;
  userId: number;
  databaseName: string;
  syncable: boolean;
  label: string;
}
export interface Blocked {
  kind: "blocked";
  reason: "outside-telegram" | "no-user";
  bot: string;
}
export const MOCK_PREFIX = "tetradio-mock-";

export const parseMockUser = (raw: unknown): number | null => {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!/^[1-9]\d{0,15}$/.test(value)) return null;
  return Number(value);
};
/** Флаг подставляется при сборке: production-сборка без него не содержит рабочего мока. */
export const MOCK_USER: number | null = parseMockUser(import.meta.env.VITE_TELEGRAM_MOCK);

export function profileFor(context: LaunchContext, mockUser: number | null = MOCK_USER): Profile | Blocked {
  if (context.kind !== "telegram") {
    if (mockUser === null) return { kind: "blocked", reason: "outside-telegram", bot: context.bot };
    return {
      kind: "mock",
      bot: context.bot,
      userId: mockUser,
      databaseName: `${MOCK_PREFIX}${mockUser}`,
      syncable: false,
      label: "Режим разработки: тестовый пользователь",
    };
  }
  const id = context.user?.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
    return { kind: "blocked", reason: "no-user", bot: context.bot };
  return {
    kind: "telegram",
    bot: context.bot,
    userId: id,
    databaseName: `tetradio-tg-${context.bot}-${id}`,
    syncable: true,
    label: "Telegram: облачная синхронизация",
  };
}
let current: Profile | Blocked | null = null;
export const launchProfile = (): Profile | Blocked => current ?? (current = profileFor(launchContext()));
/** Экраны рендерятся только при определённом владельце: остановленный запуск здесь — ошибка программы. */
export const currentProfile = (): Profile => {
  const profile = launchProfile();
  if (profile.kind === "blocked") throw new Error(`Запуск остановлен: ${profile.reason}`);
  return profile;
};
/**
 * Расхождение с пользователем bridge значит, что контекст восстановлен не от этого запуска.
 * Bridge без пользователя (не загрузился, старый клиент) владельца не опровергает.
 */
export const ownerMatches = (profile: Profile, bridgeUserId: number | undefined) =>
  profile.kind !== "telegram" || bridgeUserId === undefined || bridgeUserId === profile.userId;
/** Только для тестов. */
export const resetProfile = () => {
  current = null;
};
/** Имя базы допустимо для копии Τετράδιο: основная, тестовая или профиль Telegram. */
export const isAppDatabaseName = (name: unknown) =>
  typeof name === "string" && /^tetradio(-[A-Za-z0-9_-]+)?$/.test(name) && name !== "tetradio-restore";
