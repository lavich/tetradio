import type { ContentError } from "./schema";

export type CatalogPhase = "loading" | "ready" | "error";
let catalogState: CatalogPhase = "loading";
const catalogListeners = new Set<() => void>();
/**
 * Готовность каталога для экранов, которым важно отличить «ещё не загрузился» от «слова нет».
 * `loading` бывает только до первого успеха: фоновые обновления и их сбои показанное не прячут.
 */
export const catalogPhase = () => catalogState;
export const subscribeCatalog = (listener: () => void) => {
  catalogListeners.add(listener);
  return () => {
    catalogListeners.delete(listener);
  };
};
export const setCatalogPhase = (next: CatalogPhase) => {
  if (catalogState === next || (catalogState === "ready" && next !== "ready")) return;
  catalogState = next;
  catalogListeners.forEach((fn) => fn());
};
let catalogRequest: Promise<unknown> | null = null;
/** Идущая загрузка каталога: установка урока, которого ещё нет в кеше каталога, дожидается её, а не отказывает. */
export const trackCatalog = (request: Promise<unknown>) => {
  catalogRequest = request;
  const clear = () => {
    if (catalogRequest === request) catalogRequest = null;
  };
  request.then(clear, clear);
};
/** Завершение идущей загрузки каталога, успешной или нет; без загрузки — сразу. */
export const catalogSettled = (): Promise<void> =>
  (catalogRequest ?? Promise.resolve()).then(
    () => undefined,
    () => undefined,
  );
/** Только для тестов: вернуть каталог в состояние до первой загрузки. */
export const resetCatalogPhase = () => {
  catalogState = "loading";
};

export type InstallPhase =
  { phase: "idle" } | { phase: "loading" } | { phase: "error"; message: string; kind: ContentError["kind"] };
const IDLE: InstallPhase = { phase: "idle" };
const phases = new Map<string, InstallPhase>();
const listeners = new Set<() => void>();
export const setPhase = (lessonId: string, phase: InstallPhase) => {
  if (phase.phase === "idle") phases.delete(lessonId);
  else phases.set(lessonId, phase);
  listeners.forEach((fn) => fn());
};
/** Снимок для useSyncExternalStore должен быть стабильным по ссылке, иначе React зациклится. */
export const installPhase = (lessonId: string): InstallPhase => phases.get(lessonId) ?? IDLE;
export const subscribeInstall = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Ключ курса в общем хранилище состояний загрузки: идентификаторы курса и урока не пересекаются. */
export const courseKey = (courseId: string) => `course:${courseId}`;
export const coursePhase = (courseId: string) => installPhase(courseKey(courseId));
