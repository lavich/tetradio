/** Минимальная типизация официального bridge: используются только проверяемые на доступность методы. */
export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
  bottom_bar_bg_color?: string;
  section_separator_color?: string;
}
export interface TelegramButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(handler: () => void): void;
  offClick(handler: () => void): void;
}
export interface TelegramMainButton extends TelegramButton {
  text: string;
  isActive: boolean;
  isProgressVisible: boolean;
  setText(text: string): void;
  enable(): void;
  disable(): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
  setParams(params: { text?: string; is_active?: boolean; is_visible?: boolean }): void;
}
export interface TelegramHapticFeedback {
  impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  notificationOccurred(type: "error" | "success" | "warning"): void;
  selectionChanged(): void;
}
export interface TelegramCloudStorage {
  setItem(key: string, value: string, callback?: (error: string | null, stored?: boolean) => void): void;
  getItem(key: string, callback: (error: string | null, value?: string) => void): void;
  getItems(keys: string[], callback: (error: string | null, values?: Record<string, string>) => void): void;
  removeItem(key: string, callback?: (error: string | null, removed?: boolean) => void): void;
  removeItems(keys: string[], callback?: (error: string | null, removed?: boolean) => void): void;
  getKeys(callback: (error: string | null, keys?: string[]) => void): void;
}
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name: string; last_name?: string; username?: string; language_code?: string };
    start_param?: string;
    auth_date?: number;
  };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: TelegramThemeParams;
  isExpanded: boolean;
  isFullscreen?: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  /** Bot API 8.0: false, пока Mini App свёрнут. */
  isActive?: boolean;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  isVersionAtLeast(version: string): boolean;
  ready(): void;
  expand(): void;
  close(): void;
  /** Bot API 6.1: открыть ссылку t.me внутри Telegram, в том числе выбор чата `t.me/share/url`. */
  openTelegramLink?(url: string): void;
  onEvent(event: string, handler: (...args: unknown[]) => void): void;
  offEvent(event: string, handler: (...args: unknown[]) => void): void;
  BackButton?: TelegramButton;
  MainButton?: TelegramMainButton;
  HapticFeedback?: TelegramHapticFeedback;
  CloudStorage?: TelegramCloudStorage;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}
