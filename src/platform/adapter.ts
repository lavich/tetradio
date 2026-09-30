import { lifecycle } from "../reporting/reporting";
import type { TelegramThemeParams, TelegramWebApp } from "./telegram-types";

/**
 * Платформенный адаптер отделён от транспорта синхронизации: он отвечает за нативные элементы оболочки
 * (возврат, отклик, главное действие, тема, размеры), а код обучения не обращается к Telegram.WebApp напрямую.
 * Каждая возможность проверяется отдельно: старый клиент может дать часть API.
 */
export type HapticKind = "success" | "warning" | "error";
export interface PrimaryAction {
  text: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}
export interface PlatformTheme {
  scheme: "light" | "dark";
  params: TelegramThemeParams;
}
/** Режим запуска Mini App: компактный (не развёрнут), полноразмерный или во весь экран без шапки клиента. */
export type LaunchMode = "compact" | "fullsize" | "fullscreen";
export interface PlatformViewport {
  stableHeight: number | null;
  safeArea: { top: number; bottom: number };
  contentSafeArea: { top: number; bottom: number };
  mode: LaunchMode | null;
}
export interface PlatformCapabilities {
  back: boolean;
  haptics: boolean;
  primaryAction: boolean;
  theme: boolean;
  cloudStorage: boolean;
  expand: boolean;
}

export interface PlatformAdapter {
  kind: "web" | "telegram";
  capabilities: PlatformCapabilities;
  /**
   * Показать нативный возврат с обработчиком; возвращает функцию снятия. Без поддержки — no-op.
   * Активен обработчик с наибольшим приоритетом, среди равных — последний; резервный обработчик оболочки имеет приоритет 0.
   */
  back(handler: () => void, priority?: number): () => void;
  hideBack(): void;
  haptic(kind: HapticKind): void;
  /** Нативное главное действие: текст, loading/disabled, замена обработчика; снятие — `clearPrimaryAction`. */
  primaryAction(action: PrimaryAction): void;
  clearPrimaryAction(): void;
  theme(): PlatformTheme;
  viewport(): PlatformViewport;
  onThemeChange(listener: () => void): () => void;
  onViewportChange(listener: () => void): () => void;
  /** Активность Mini App (Bot API 8.0: `activated`/`deactivated`); без поддержки — всегда активен. */
  active(): boolean;
  onActiveChange(listener: (active: boolean) => void): () => void;
  ready(): void;
  dispose(): void;
}

const NONE = () => undefined;
export function webAdapter(): PlatformAdapter {
  return {
    kind: "web",
    capabilities: {
      back: false,
      haptics: false,
      primaryAction: false,
      theme: false,
      cloudStorage: false,
      expand: false,
    },
    back: () => NONE,
    hideBack: NONE,
    haptic: NONE,
    primaryAction: NONE,
    clearPrimaryAction: NONE,
    theme: () => ({ scheme: "light", params: {} }),
    viewport: () => ({
      stableHeight: null,
      safeArea: { top: 0, bottom: 0 },
      contentSafeArea: { top: 0, bottom: 0 },
      mode: null,
    }),
    onThemeChange: () => NONE,
    onViewportChange: () => NONE,
    active: () => true,
    onActiveChange: () => NONE,
    ready: NONE,
    dispose: NONE,
  };
}

const has = (value: unknown, method: string) =>
  !!value && typeof (value as Record<string, unknown>)[method] === "function";
const attempt = (action: () => void) => {
  try {
    action();
  } catch (error) {
    console.warn("Telegram API отклонил вызов", error);
  }
};

/**
 * Подписки на bridge регистрируются один раз на адаптер и снимаются симметрично в `dispose`,
 * поэтому повторное подключение в StrictMode не удваивает обработчики.
 */
export function telegramAdapter(app: TelegramWebApp): PlatformAdapter {
  const backButton = app.BackButton,
    mainButton = app.MainButton,
    haptics = app.HapticFeedback;
  const supports = (version: string) => {
    try {
      return app.isVersionAtLeast(version);
    } catch {
      return false;
    }
  };
  const capabilities: PlatformCapabilities = {
    back: has(backButton, "show") && has(backButton, "onClick") && supports("6.1"),
    haptics: has(haptics, "notificationOccurred") && supports("6.1"),
    primaryAction: has(mainButton, "setParams") && has(mainButton, "onClick"),
    theme: true,
    cloudStorage: has(app.CloudStorage, "getItems") && supports("6.9"),
    expand: has(app, "expand"),
  };
  const backStack: { handler: () => void; priority: number }[] = [];
  const activeBack = () =>
    backStack.reduce<{ handler: () => void; priority: number } | null>(
      (best, entry) => (!best || entry.priority >= best.priority ? entry : best),
      null,
    );
  const syncBack = () =>
    attempt(() => {
      if (backStack.length) backButton!.show();
      else backButton!.hide();
    });
  let primary: PrimaryAction | null = null;
  const themeListeners = new Set<() => void>(),
    viewportListeners = new Set<() => void>(),
    activeListeners = new Set<(active: boolean) => void>();
  const onBack = () => activeBack()?.handler();
  const onMain = () => {
    if (primary && !primary.disabled && !primary.loading) primary.onClick();
  };
  const onTheme = () => themeListeners.forEach((listener) => listener());
  // Крошки жизненного цикла для отчётов о сбоях: имя события и размеры области просмотра, ничего из данных запуска.
  const sizes = () => ({
    height: Number.isFinite(app.viewportHeight) ? app.viewportHeight : null,
    stableHeight: Number.isFinite(app.viewportStableHeight) ? app.viewportStableHeight : null,
    expanded: !!app.isExpanded,
    fullscreen: !!app.isFullscreen,
  });
  const onViewport = (...args: unknown[]) => {
    const state = args[0] as { isStateStable?: boolean } | undefined;
    // Док занятия следует за устойчивой высотой, а не за каждым кадром анимации клавиатуры.
    if (state && state.isStateStable === false) return;
    lifecycle("viewportChanged", sizes());
    viewportListeners.forEach((listener) => listener());
  };
  const onActivated = () => {
    lifecycle("activated", sizes());
    activeListeners.forEach((listener) => listener(true));
  };
  const onDeactivated = () => {
    lifecycle("deactivated", sizes());
    activeListeners.forEach((listener) => listener(false));
  };
  if (capabilities.back) attempt(() => backButton!.onClick(onBack));
  if (capabilities.primaryAction) attempt(() => mainButton!.onClick(onMain));
  attempt(() => app.onEvent("themeChanged", onTheme));
  attempt(() => app.onEvent("viewportChanged", onViewport));
  attempt(() => app.onEvent("safeAreaChanged", onViewport));
  attempt(() => app.onEvent("contentSafeAreaChanged", onViewport));
  attempt(() => app.onEvent("fullscreenChanged", onViewport));
  attempt(() => app.onEvent("activated", onActivated));
  attempt(() => app.onEvent("deactivated", onDeactivated));
  const inset = (value: { top: number; bottom: number } | undefined) => ({
    top: value?.top ?? 0,
    bottom: value?.bottom ?? 0,
  });
  return {
    kind: "telegram",
    capabilities,
    back(handler, priority = 1) {
      if (!capabilities.back) return NONE;
      const entry = { handler, priority };
      backStack.push(entry);
      syncBack();
      return () => {
        const index = backStack.indexOf(entry);
        if (index >= 0) backStack.splice(index, 1);
        syncBack();
      };
    },
    hideBack() {
      backStack.length = 0;
      if (capabilities.back) attempt(() => backButton!.hide());
    },
    haptic(kind) {
      if (capabilities.haptics) attempt(() => haptics!.notificationOccurred(kind));
    },
    primaryAction(action) {
      if (!capabilities.primaryAction) return;
      primary = action;
      attempt(() => {
        mainButton!.setParams({ text: action.text, is_active: !action.disabled && !action.loading, is_visible: true });
        if (action.loading) mainButton!.showProgress(false);
        else mainButton!.hideProgress();
      });
    },
    clearPrimaryAction() {
      primary = null;
      if (capabilities.primaryAction)
        attempt(() => {
          mainButton!.hideProgress();
          mainButton!.hide();
        });
    },
    theme: () => ({ scheme: app.colorScheme === "dark" ? "dark" : "light", params: app.themeParams ?? {} }),
    viewport: () => ({
      stableHeight:
        Number.isFinite(app.viewportStableHeight) && app.viewportStableHeight > 0 ? app.viewportStableHeight : null,
      safeArea: inset(app.safeAreaInset),
      contentSafeArea: inset(app.contentSafeAreaInset),
      mode: app.isFullscreen ? "fullscreen" : app.isExpanded ? "fullsize" : "compact",
    }),
    onThemeChange(listener) {
      themeListeners.add(listener);
      return () => {
        themeListeners.delete(listener);
      };
    },
    onViewportChange(listener) {
      viewportListeners.add(listener);
      return () => {
        viewportListeners.delete(listener);
      };
    },
    active: () => app.isActive !== false,
    onActiveChange(listener) {
      activeListeners.add(listener);
      return () => {
        activeListeners.delete(listener);
      };
    },
    ready() {
      attempt(() => app.ready());
      if (capabilities.expand && !app.isExpanded) attempt(() => app.expand());
    },
    dispose() {
      if (capabilities.back)
        attempt(() => {
          backButton!.offClick(onBack);
          backButton!.hide();
        });
      if (capabilities.primaryAction)
        attempt(() => {
          mainButton!.offClick(onMain);
          mainButton!.hide();
        });
      attempt(() => app.offEvent("themeChanged", onTheme));
      attempt(() => app.offEvent("viewportChanged", onViewport));
      attempt(() => app.offEvent("safeAreaChanged", onViewport));
      attempt(() => app.offEvent("contentSafeAreaChanged", onViewport));
      attempt(() => app.offEvent("fullscreenChanged", onViewport));
      attempt(() => app.offEvent("activated", onActivated));
      attempt(() => app.offEvent("deactivated", onDeactivated));
      themeListeners.clear();
      viewportListeners.clear();
      activeListeners.clear();
      backStack.length = 0;
      primary = null;
    },
  };
}
