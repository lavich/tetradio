/**
 * Контекст запуска определяется синхронно по параметрам URL, которые Telegram добавляет к адресу Mini App:
 * `#tgWebAppData=…&tgWebAppPlatform=…&tgWebAppVersion=…`. Один глобальный объект `Telegram.WebApp`
 * признаком запуска не считается — библиотека может присутствовать и в обычном браузере.
 * Параметры используются только для интерфейса и выбора локального профиля, не как доверенная авторизация.
 */
export interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
}
export interface LaunchContext {
  kind: "web" | "telegram";
  /** Имя бота из адреса Mini App (`?bot=TaveloriDevBot`); без параметра — основной бот. */
  bot: string;
  platform: string | null;
  version: string | null;
  user: TelegramUser | null;
  startParam: string | null;
  /**
   * Идентификатор сессии запуска (`query_id` из `tgWebAppData`): у перезагрузки того же запуска он прежний,
   * у нового запуска — новый. Telegram передаёт его не всегда; без него и вне Telegram — `null`.
   */
  launchId: string | null;
}
export const DEFAULT_BOT = "TaveloriBot";
const STORAGE_KEY = "lexi:launch";
const CONSUMED_KEY = "lexi:start-consumed";

const parseUser = (raw: string | null): TelegramUser | null => {
  if (!raw) return null;
  try {
    const user = JSON.parse(raw);
    if (typeof user?.id !== "number") return null;
    return {
      id: user.id,
      firstName: String(user.first_name ?? ""),
      lastName: user.last_name,
      username: user.username,
      languageCode: user.language_code,
    };
  } catch {
    return null;
  }
};
const BOT_NAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
/** Бот, явно указанный в адресе; без параметра или с плохим именем — `null`. */
const botParam = (search: string) => {
  const bot = new URLSearchParams(search).get("bot")?.replace(/^@/, "") ?? "";
  return BOT_NAME.test(bot) ? bot : null;
};

/** Разбор без побочных эффектов: параметры Telegram живут в hash, имя бота — в query. */
export function parseLaunch(location: { hash: string; search: string }): LaunchContext {
  const bot = botParam(location.search) ?? DEFAULT_BOT;
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const platform = hash.get("tgWebAppPlatform");
  const data = hash.get("tgWebAppData");
  if (!platform && !data) return webContext(bot);
  const init = new URLSearchParams(data ?? "");
  return {
    kind: "telegram",
    bot,
    platform,
    version: hash.get("tgWebAppVersion"),
    user: parseUser(init.get("user")),
    startParam: init.get("start_param"),
    launchId: init.get("query_id") || null,
  };
}
const webContext = (bot: string): LaunchContext => ({
  kind: "web",
  bot,
  platform: null,
  version: null,
  user: null,
  startParam: null,
  launchId: null,
});

const readStored = (): LaunchContext | null => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<LaunchContext>) : null;
    if (parsed?.kind !== "telegram" && parsed?.kind !== "web") return null;
    const bot = typeof parsed.bot === "string" && BOT_NAME.test(parsed.bot) ? parsed.bot : DEFAULT_BOT;
    if (parsed.kind === "web") return webContext(bot);
    return {
      kind: "telegram",
      bot,
      platform: parsed.platform ?? null,
      version: parsed.version ?? null,
      user: parsed.user ?? null,
      startParam: parsed.startParam ?? null,
      launchId: parsed.launchId ?? null,
    };
  } catch {
    return null; // нет хранилища или запись повреждена
  }
};
const store = (context: LaunchContext) => {
  try {
    // Веб-запись хранит только вид и бота: остальное в браузере берётся из адреса.
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(context.kind === "web" ? { kind: "web", bot: context.bot } : context),
    );
  } catch {
    /* приватный режим */
  }
};

let cached: LaunchContext | null = null;
/**
 * Контекст читается один раз при загрузке и запоминается на время вкладки: маршрутизация убирает hash и `?bot=`,
 * а перезагрузка внутри WebView должна остаться тем же запуском с тем же ботом и профилем.
 * Порядок строгий: разбор адреса, чтение сохранённого, запись последней.
 * - Данные Telegram в адресе — новый запуск: его контекст заменяет сохранённый целиком.
 * - Данных нет, а сохранён Telegram-контекст — перезагрузка: он восстанавливается, из адреса берётся только `?bot=`.
 * - Иначе — веб; веб-запись никогда не затирает Telegram-запись.
 * Бот: `?bot=` из адреса, иначе сохранённый, иначе основной.
 */
export function launchContext(): LaunchContext {
  if (cached) return cached;
  if (typeof window === "undefined") return (cached = webContext(DEFAULT_BOT));
  const fresh = parseLaunch(window.location);
  const explicit = botParam(window.location.search);
  const stored = readStored();
  const bot = explicit ?? stored?.bot ?? DEFAULT_BOT;
  if (fresh.kind === "telegram") {
    cached = { ...fresh, bot };
    store(cached);
  } else if (stored?.kind === "telegram") {
    cached = { ...stored, bot };
    if (bot !== stored.bot) store(cached);
  } else {
    cached = webContext(bot);
    store(cached);
  }
  return cached;
}
/** Только для тестов: сбросить запомненный контекст. */
export const resetLaunchContext = () => {
  cached = null;
};

const WORD_START = /^w_([A-Za-z0-9-]{1,60})$/;
/** Путь по параметру запуска Mini App: `w_<id>` — слово; остальное приложение не знает и открывает «Сегодня». */
export function startRoute(launch: LaunchContext): string | null {
  if (launch.kind !== "telegram" || !launch.startParam) return null;
  const match = WORD_START.exec(launch.startParam);
  return match ? `/share/word/${match[1]}` : null;
}

let consumedInPage = false;
/**
 * Путь запуска, если его ещё не открывали. С `launchId` метка в `sessionStorage` отличает перезагрузку того же
 * запуска от нового; без него повтор запрещает только флаг страницы: перезагрузка может снова открыть слово,
 * зато новый запуск никогда не примут за перезагрузку.
 */
export function takeStartRoute(launch: LaunchContext = launchContext()): string | null {
  const route = startRoute(launch);
  if (!route) return null;
  if (launch.launchId) {
    try {
      if (sessionStorage.getItem(CONSUMED_KEY) === launch.launchId) return null;
      sessionStorage.setItem(CONSUMED_KEY, launch.launchId);
      return route;
    } catch {
      /* хранилище недоступно — остаётся флаг страницы */
    }
  }
  if (consumedInPage) return null;
  consumedInPage = true;
  return route;
}
