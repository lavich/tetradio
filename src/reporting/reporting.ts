import { launchContext } from "../platform/launch";
import { LIFECYCLE_CATEGORY } from "./scrub";

/**
 * Лёгкая точка входа отчётов о сбоях. Загружается в стартовом чанке и почти ничего не весит:
 * ставит крошечные обработчики `error`/`unhandledrejection`, копит до десяти ранних ошибок
 * и передаёт их SDK, который подгружается отдельным чанком после чтения настройки.
 * Без адреса приёма (`VITE_SENTRY_DSN`) всё здесь — пустые операции: разработка и тесты не тянут SDK и не ходят в сеть.
 */
export type ReportCategory = "storage" | "content" | "sync" | "service-worker" | "ui";
export type ReportExtra = Record<string, string | number | boolean | null | undefined>;
export interface ReportOptions {
  category?: ReportCategory;
  extra?: ReportExtra;
}
export type Mechanism = "explicit" | "onerror" | "onunhandledrejection";
export interface CaptureHint {
  id: string;
  category?: ReportCategory;
  extra?: ReportExtra;
  mechanism: Mechanism;
}
export interface LifecycleCrumb {
  category: typeof LIFECYCLE_CATEGORY;
  message: string;
  data: Record<string, number | boolean | string | null>;
}
export interface SdkOptions {
  dsn: string;
  release: string;
  tags: Record<string, string>;
}
/** Контракт тяжёлого чанка (`./sentry`): подменяется в тестах, поэтому реальный импорт там не происходит. */
export interface Sdk {
  init(options: SdkOptions): void;
  capture(error: unknown, hint: CaptureHint): void;
  breadcrumb(crumb: LifecycleCrumb): void;
  close(): Promise<void>;
}

/** Имя отдельной базы IndexedDB офлайн-очереди SDK: не таблица приложения, не входит в копию, удаляется при выключении. */
export const OFFLINE_DB = "lexi-error-reports";
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
export const APP_BUILD = typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "dev";
export const RELEASE = `lexi@${APP_VERSION}+${APP_BUILD}`;
const EARLY_LIMIT = 10,
  CRUMB_LIMIT = 20;

interface Pending {
  error: unknown;
  hint: CaptureHint;
}
type State = "waiting" | "loading" | "ready" | "off";
let dsn: string | undefined = import.meta.env.VITE_SENTRY_DSN || undefined;
let loader: () => Promise<Sdk> = () => import("./sentry");
let state: State = "waiting";
let sdk: Sdk | null = null;
let pending: Pending[] = [];
let crumbs: LifecycleCrumb[] = [];
let generation = 0;
let earlyInstalled = false;

const newId = () => {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  }
};
const onError = (event: ErrorEvent) => enqueue(event.error ?? event.message, { id: newId(), mechanism: "onerror" });
const onRejection = (event: PromiseRejectionEvent) =>
  enqueue(event.reason, { id: newId(), mechanism: "onunhandledrejection" });

function enqueue(error: unknown, hint: CaptureHint) {
  if (state === "ready" && sdk) {
    sdk.capture(error, hint);
    return;
  }
  if (state === "off") return;
  if (pending.length < EARLY_LIMIT) pending.push({ error, hint });
}
function removeEarly() {
  if (!earlyInstalled) return;
  window.removeEventListener("error", onError);
  window.removeEventListener("unhandledrejection", onRejection);
  earlyInstalled = false;
}

/** Ранние обработчики ставятся первой строкой точки входа: отказы запуска нам интереснее всего. */
export function installEarlyHandlers() {
  if (!dsn || earlyInstalled || typeof window === "undefined") return;
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  earlyInstalled = true;
}
export const reportingConfigured = () => !!dsn;
export const reportingEnabled = () => state === "ready";

/** Явный отчёт о критическом отказе. Возвращает идентификатор отчёта или `null`, когда отчёты не настроены или выключены. */
export function reportError(error: unknown, options: ReportOptions = {}): string | null {
  if (!dsn || state === "off") return null;
  const hint: CaptureHint = { id: newId(), category: options.category, extra: options.extra, mechanism: "explicit" };
  enqueue(error, hint);
  return hint.id;
}
/** Крошка жизненного цикла Mini App: только имя события и размеры области просмотра. */
export function lifecycle(message: string, data: LifecycleCrumb["data"] = {}) {
  if (!dsn || state === "off") return;
  const crumb: LifecycleCrumb = { category: LIFECYCLE_CATEGORY, message, data };
  if (state === "ready" && sdk) {
    sdk.breadcrumb(crumb);
    return;
  }
  if (crumbs.length >= CRUMB_LIMIT) crumbs.shift();
  crumbs.push(crumb);
}

function tags(): Record<string, string> {
  const launch = launchContext();
  const result: Record<string, string> = { env: launch.kind, "app.version": APP_VERSION, "app.build": APP_BUILD };
  if (launch.kind === "telegram") {
    if (launch.version) result["tg.version"] = launch.version;
    if (launch.platform) result["tg.platform"] = launch.platform;
  }
  return result;
}
const idle = (task: () => void) => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => task(), { timeout: 2000 });
  else setTimeout(task, 0);
};

/**
 * Настройка прочитана: включение загружает SDK отдельным чанком после первого рендера и отдаёт ему накопленное;
 * выключение действует немедленно — очередь очищается, SDK закрывается, офлайн-очередь удаляется.
 */
export function setReportingEnabled(enabled: boolean) {
  if (!dsn) return;
  if (!enabled) {
    state = "off";
    pending = [];
    crumbs = [];
    removeEarly();
    const current = sdk;
    sdk = null;
    generation++;
    const clear = () => {
      try {
        indexedDB.deleteDatabase(OFFLINE_DB);
      } catch {
        /* без IndexedDB очереди нет */
      }
    };
    if (current) current.close().then(clear, clear);
    else clear();
    return;
  }
  if (state === "ready" || state === "loading") return;
  state = "loading";
  const mine = ++generation;
  const address = dsn;
  idle(() => {
    if (generation !== mine) return;
    loader()
      .then((loaded) => {
        if (generation !== mine) return;
        loaded.init({ dsn: address, release: RELEASE, tags: tags() });
        sdk = loaded;
        state = "ready";
        removeEarly();
        for (const crumb of crumbs) loaded.breadcrumb(crumb);
        crumbs = [];
        for (const { error, hint } of pending) loaded.capture(error, hint);
        pending = [];
      })
      .catch((error) => {
        if (generation !== mine) return;
        state = "waiting";
        console.warn("Отчёты об ошибках недоступны", error);
      });
  });
}

/** Только для тестов: ранние отчёты и крошки в очереди. */
export const pendingReports = () => pending.map((entry) => entry.hint);
export const pendingCrumbs = () => [...crumbs];
/** Только для тестов: сброс состояния с подменой адреса и загрузчика SDK. */
export function resetReporting(options: { dsn?: string; loader?: () => Promise<Sdk> } = {}) {
  removeEarly();
  generation++;
  state = "waiting";
  sdk = null;
  pending = [];
  crumbs = [];
  dsn = "dsn" in options ? options.dsn : import.meta.env.VITE_SENTRY_DSN || undefined;
  loader = options.loader ?? (() => import("./sentry"));
}
