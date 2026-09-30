import { launchContext, type LaunchContext } from "../platform/launch";

/**
 * Локальные профили разделены по режиму запуска: обычный браузер хранит данные в базе `lexi`,
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
export const WEB_DATABASE = "lexi";

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
      databaseName: `lexi-tg-${context.bot}-anonymous`,
      syncable: false,
      label: "Telegram: профиль не определён",
    };
  return {
    kind: "telegram",
    bot: context.bot,
    userId: context.user.id,
    databaseName: `lexi-tg-${context.bot}-${context.user.id}`,
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
/** Имя базы допустимо для копии Lexi: основная, тестовая или профиль Telegram. */
export const isLexiDatabaseName = (name: unknown) =>
  typeof name === "string" && /^lexi(-[A-Za-z0-9_-]+)?$/.test(name) && name !== "lexi-restore";
