import { lifecycle } from "../reporting/reporting";

const KEY = "lexi:stale-build-reload";
/** Перезагрузка чаще этого считается циклом: чанк не грузится не из-за сборки, и отказ уходит в границу ошибок. */
const RELOAD_GUARD_MS = 30000;

export interface StaleBuildOptions {
  storage?: Pick<Storage, "getItem" | "setItem">;
  reload?: () => void;
  online?: () => boolean;
  now?: () => number;
}

/**
 * Загрузка ленивого экрана. Публикация на Pages заменяет все чанки, а WebView Telegram после сна продолжает старую сборку:
 * её чанк уже удалён, и `import()` падает с `TypeError`. Тогда страница один раз перезагружается на новую сборку — маршрут
 * в адресе, занятие в IndexedDB, — а экран ждёт перезагрузки вместо падения. Без сети, без sessionStorage или при повторе
 * вскоре после перезагрузки отказ пробрасывается в границу ошибок и уходит в отчёт.
 */
export function loadScreen<T>(load: () => Promise<T>, options: StaleBuildOptions = {}): Promise<T> {
  const {
    storage = globalThis.sessionStorage,
    reload = () => window.location.reload(),
    online = () => navigator.onLine !== false,
    now = Date.now,
  } = options;
  return load().catch((error: unknown) => {
    if (!(error instanceof TypeError) || !online()) throw error;
    const at = now();
    try {
      const last = Number(storage.getItem(KEY));
      if (Number.isFinite(last) && at - last < RELOAD_GUARD_MS) throw error;
      storage.setItem(KEY, String(at));
    } catch {
      throw error;
    }
    lifecycle("staleBuildReload");
    reload();
    return new Promise<T>(() => {});
  });
}
