import { useLiveQuery } from "dexie-react-hooks";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import {
  catalogPhase,
  contentUrl,
  coursePhase,
  ensureAsset,
  firstLessonOf,
  previewMedia,
  subscribeCatalog,
  subscribeInstall,
} from "../content/client";
import type { ContentPackage } from "../content/schema";
import { deviceTimezone, makePlan, studyDay, type DailyPlan } from "../domain/learning";
import { progress } from "../domain/stats";
import { defaultSettings } from "../domain/types";
import { db } from "../storage/db";
import { dexieSource, loadSettings } from "../storage/queries";
import { languagePlan } from "../storage/today";
import type { Language } from "../domain/language";

/**
 * Каждый экран подписывается только на свою выборку. Общего реактивного снимка базы больше нет:
 * Dexie отслеживает прочитанные диапазоны и перезапускает запрос при изменении именно их.
 */
export function useSettings() {
  const settings = useLiveQuery(() => loadSettings(), []);
  return { settings: settings ?? defaultSettings, ready: !!settings };
}
/** «Сегодня» нужно только знать, есть ли уроки: счётчик пакетов вместо чтения уроков. */
export const useInstalledCount = () => useLiveQuery(() => db.packages.count(), []);
/** `undefined` — ещё читается, `null` — урока нет локально. */
export const useWord = (id: string | undefined) => useLiveQuery(() => (id ? db.words.get(id) : undefined), [id]);
export const usePhrase = (id: string | undefined) =>
  useLiveQuery(async () => (id ? ((await db.phrases.get(id)) ?? null) : undefined), [id]);
/** Время запрос плана берёт сам: перечитывается по сроку `wakeAt` и при возврате в приложение, а не каждую минуту. */
function useWakingPlan(read: () => Promise<DailyPlan> | undefined, deps: unknown[]) {
  const [tick, setTick] = useState(0);
  const plan = useLiveQuery(read, [...deps, tick]);
  const wakeAt = plan?.wakeAt.getTime();
  useEffect(() => {
    if (wakeAt === undefined) return;
    const id = setTimeout(() => setTick((value) => value + 1), Math.max(wakeAt - Date.now(), 0) + 50);
    return () => clearTimeout(id);
  }, [wakeAt, tick]);
  useEffect(() => {
    const wake = () => document.visibilityState === "visible" && setTick((value) => value + 1);
    document.addEventListener("visibilitychange", wake);
    return () => document.removeEventListener("visibilitychange", wake);
  }, []);
  return plan;
}
/** План курса; `null` — по всем курсам (курсов в каталоге нет), `undefined` — курс ещё читается. */
export const usePlan = (courseId: string | null | undefined) =>
  useWakingPlan(
    () =>
      courseId === undefined ? undefined : makePlan(dexieSource(), new Date(), { courseId: courseId ?? undefined }),
    [courseId],
  );
/** План языка «Сегодня»; `null` — курсов в каталоге нет, план по всем урокам; `undefined` — язык ещё читается. */
export const useLanguagePlan = (language: Language | null | undefined) =>
  useWakingPlan(() => (language === undefined ? undefined : languagePlan(new Date(), language)), [language]);
/** Статистика зависит от учебного дня, а не от минуты. */
export const useStats = (now: Date) =>
  useLiveQuery(() => progress(dexieSource(), now), [studyDay(now, deviceTimezone())]);
/** Счётчики экрана «Ещё»: только числа по индексам, без чтения самих карточек. */
export const useCounts = () =>
  useLiveQuery(async () => {
    const [words, phrases, answers] = await Promise.all([db.words.count(), db.phrases.count(), db.events.count()]);
    return { words, cards: words + phrases, answers };
  }, []);

export const useCatalog = () =>
  useLiveQuery(async () => {
    const [entries, modules] = await Promise.all([db.catalog.toArray(), db.modules.toArray()]);
    return { entries, modules };
  }, []);
export const useCatalogPhase = () => useSyncExternalStore(subscribeCatalog, catalogPhase);
/** Урок каталога, из которого слово: `undefined` — ещё читается, `null` — слова в каталоге нет. */
export const useWordLesson = (id: string | undefined) =>
  useLiveQuery(async () => (id ? firstLessonOf(await db.catalog.toArray(), id) : null), [id]);
export const useCourses = () => useLiveQuery(() => db.courses.toArray(), []);
export const useCoursePhase = (courseId: string | undefined) =>
  useSyncExternalStore(subscribeInstall, () => coursePhase(courseId ?? ""));

/**
 * Откуда карточка берёт файлы медиа. По умолчанию — из базы: файл докачивается и сохраняется, как при установке.
 * Просмотр без установки подставляет свой источник с прямыми адресами пакета и в базу не пишет.
 */
export interface AssetSource {
  url(assetId: string): Promise<string | null>;
}
export const dbAssetSource: AssetSource = {
  url: async (assetId) => {
    const asset = await ensureAsset(assetId);
    return asset ? URL.createObjectURL(asset.blob) : null;
  },
};
/** Адрес из `URL.createObjectURL` принадлежит тому, кто его получил: прямой адрес освобождать не нужно. */
export const releaseAssetUrl = (url: string) => {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
};
/** Источник просмотра: прямые адреса медиа пакета, без проверки и без записи в `db.assets`. */
export function packageAssetSource(pack: ContentPackage): AssetSource {
  const media = previewMedia(pack);
  return {
    url: async (assetId) => {
      const item = media.get(assetId);
      return item ? contentUrl(item.url) : null;
    },
  };
}
export const AssetSourceContext = createContext<AssetSource>(dbAssetSource);
export const useAssetSource = () => useContext(AssetSourceContext);

export function useAssetUrl(id: string | undefined): string | null {
  const source = useAssetSource();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let owned: string | null = null,
      alive = true;
    if (!id) {
      setUrl(null);
      return;
    }
    source
      .url(id)
      .then((next) => {
        if (!alive) {
          if (next) releaseAssetUrl(next);
          return;
        }
        owned = next;
        setUrl(next);
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
      if (owned) releaseAssetUrl(owned);
    };
  }, [id, source]);
  return url;
}
