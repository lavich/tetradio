import { launchContext, type LaunchContext } from "../platform/launch";

/**
 * Владелец локальных данных — пара «бот + Telegram-пользователь»: у каждой пары своя база
 * `tetradio-tg-<bot>-<id>`. Telegram ID здесь лишь локальный селектор, а не серверное доказательство личности;
 * облачную область задаёт сам Telegram.
 *
 * Анонимного и браузерного профиля нет. Вне Telegram и без пользователя в initData владелец не определён:
 * запуск останавливается до открытия базы (`Blocked`), ничего не читается и не отправляется.
 * Исключение — сборка с флагом `VITE_TELEGRAM_MOCK=<id>` (разработка и e2e): вне Telegram она работает под
 * тестовым пользователем в отдельной базе `tetradio-mock-<id>` без облачной синхронизации.
 */
export interface Profile {
  kind: "telegram" | "mock";
  bot: string;
  userId: number;
  databaseName: string;
  syncable: boolean;
  label: string;
}
/** Запуск без определённого владельца: вне Telegram или Telegram не передал пользователя. */
export interface Blocked {
  kind: "blocked";
  reason: "outside-telegram" | "no-user";
  bot: string;
}
export const MOCK_PREFIX = "tetradio-mock-";

/** Тестовый пользователь из флага сборки: положительное целое — его ID; без флага или с другим значением — `null`. */
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
/** Результат запуска: профиль владельца или причина остановки. Вычисляется один раз на страницу. */
export const launchProfile = (): Profile | Blocked => current ?? (current = profileFor(launchContext()));
/**
 * Профиль работающего приложения. Экраны и синхронизация рендерятся только при определённом владельце,
 * поэтому вызов при остановленном запуске — ошибка программы, а не штатное состояние.
 */
export const currentProfile = (): Profile => {
  const profile = launchProfile();
  if (profile.kind === "blocked") throw new Error(`Запуск остановлен: ${profile.reason}`);
  return profile;
};
/**
 * Пользователь bridge Telegram совпадает с владельцем открытой базы. Bridge разбирает тот же initData, что и
 * адрес; расхождение значит, что контекст восстановлен не от этого запуска, — данные такого владельца не трогаются.
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
