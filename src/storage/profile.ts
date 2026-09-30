import { launchContext, type LaunchContext } from "../platform/launch";

/**
 * Локальные профили разделены по режиму запуска: обычный браузер хранит данные в базе `tetradio`,
 * Telegram — в отдельной базе на пару «бот + пользователь». Telegram ID здесь лишь локальный селектор,
 * а не серверное доказательство личности; облачную область задаёт сам Telegram.
 * Без сведений о пользователе открывается отдельный анонимный профиль без облачной записи.
 */
export interface Profile {
  kind: "web" | "telegram";
  bot: string;
  userId: number | null;
  databaseName: string;
  syncable: boolean;
  label: string;
}
export const WEB_DATABASE = "tetradio";

export function profileFor(context: LaunchContext): Profile {
  if (context.kind !== "telegram")
    return {
      kind: "web",
      bot: context.bot,
      userId: null,
      databaseName: WEB_DATABASE,
      syncable: false,
      label: "В этом браузере",
    };
  if (!context.user)
    return {
      kind: "telegram",
      bot: context.bot,
      userId: null,
      databaseName: `tetradio-tg-${context.bot}-anonymous`,
      syncable: false,
      label: "Telegram: профиль не определён",
    };
  return {
    kind: "telegram",
    bot: context.bot,
    userId: context.user.id,
    databaseName: `tetradio-tg-${context.bot}-${context.user.id}`,
    syncable: true,
    label: "Telegram: облачная синхронизация",
  };
}
let current: Profile | null = null;
export const currentProfile = (): Profile => current ?? (current = profileFor(launchContext()));
/** Только для тестов. */
export const resetProfile = () => {
  current = null;
};
/** Имя базы допустимо для копии Τετράδιο: основная, тестовая или профиль Telegram. */
export const isAppDatabaseName = (name: unknown) =>
  typeof name === "string" && /^tetradio(-[A-Za-z0-9_-]+)?$/.test(name) && name !== "tetradio-restore";
