import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import {
  catalogPhase,
  contentUrl,
  coursePhase,
  ensureAsset,
  firstLessonOf,
  installPhase,
  lessonReadiness,
  previewMedia,
  subscribeCatalog,
  subscribeInstall,
} from "../content/client";
import type { ContentPackage } from "../content/schema";
import { makePlan } from "../domain/learning";
import { progress } from "../domain/stats";
import { defaultSettings, type Session } from "../domain/types";
import { db } from "../storage/db";
import {
  dexieSource,
  lessonDetail,
  lessonsOfWord,
  lessonViews,
  loadSettings,
  wordPage,
  type WordFilter,
  type WordPage,
} from "../storage/queries";

/**
 * Каждый экран подписывается только на свою выборку. Общего реактивного снимка базы больше нет:
 * Dexie отслеживает прочитанные диапазоны и перезапускает запрос при изменении именно их.
 */
export function useSettings() {
  const settings = useLiveQuery(() => loadSettings(), []);
  return { settings: settings ?? defaultSettings, ready: !!settings };
}
export const useLessons = (withProgress = false) => useLiveQuery(() => lessonViews(db, withProgress), [withProgress]);
/** `undefined` — ещё читается, `null` — урока нет локально. */
export const useLesson = (id: string | undefined) => useLiveQuery(() => (id ? lessonDetail(id) : null), [id]);
export const useWord = (id: string | undefined) => useLiveQuery(() => (id ? db.words.get(id) : undefined), [id]);
export const useWordLessons = (id: string | undefined) => useLiveQuery(() => (id ? lessonsOfWord(id) : []), [id]) ?? [];
export const usePlan = (now: Date) => useLiveQuery(() => makePlan(dexieSource(), now), [now.getTime()]);
export const useStats = (now: Date) => useLiveQuery(() => progress(dexieSource(), now), [now.getTime()]);
export const useActiveSession = (): Session | undefined | null =>
  useLiveQuery(
    () =>
      db.sessions
        .where("[status+createdAt]")
        .between(["active", Dexie.minKey], ["active", Dexie.maxKey])
        .reverse()
        .first()
        .then((session) => session ?? null),
    [],
  );
/** Счётчики экрана «Ещё»: только числа по индексам, без чтения самих карточек. */
export const useCounts = () =>
  useLiveQuery(async () => {
    const live = async (table: {
      count(): Promise<number>;
      where(index: string): { above(value: string): { count(): Promise<number> } };
    }) => (await table.count()) - (await table.where("deletedAt").above("").count());
    const [words, phrases, answers] = await Promise.all([live(db.words), live(db.phrases), db.events.count()]);
    return { words, cards: words + phrases, answers };
  }, []);

export const useCatalog = () =>
  useLiveQuery(async () => ({ entries: await db.catalog.toArray(), packages: await db.packages.toArray() }), []);
export const useInstallPhase = (lessonId: string | undefined) =>
  useSyncExternalStore(subscribeInstall, () => installPhase(lessonId ?? ""));
export const useCatalogPhase = () => useSyncExternalStore(subscribeCatalog, catalogPhase);
/** Урок каталога, из которого слово: `undefined` — ещё читается, `null` — слова в каталоге нет. */
export const useWordLesson = (id: string | undefined) =>
  useLiveQuery(async () => (id ? firstLessonOf(await db.catalog.toArray(), id) : null), [id]);
/** Слово в версии курса из установленных пакетов: делятся им, а не локальной правкой. */
export const useShippedWord = (id: string | undefined) =>
  useLiveQuery(
    async () =>
      id ? (await db.packages.toArray()).flatMap((pack) => pack.words).find((word) => word.id === id) : undefined,
    [id],
  );
export const useCourses = () => useLiveQuery(() => db.courses.toArray(), []);
export const useCoursePhase = (courseId: string | undefined) =>
  useSyncExternalStore(subscribeInstall, () => coursePhase(courseId ?? ""));
export const useReadiness = (lessonId: string | undefined) =>
  useLiveQuery(() => (lessonId ? lessonReadiness(lessonId) : undefined), [lessonId]);
/** Число живых фраз: достаточность пула вариантов для аудирования фраз без перевода. */
export const usePhraseCount = () =>
  useLiveQuery(async () => (await db.phrases.count()) - (await db.phrases.where("deletedAt").above("").count()), []);

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

export interface WordListRequest {
  query: string;
  filter: WordFilter;
  lessonId: string | null;
}
/** Первая страница живая, следующие подгружаются по запросу и сбрасываются при смене условий. */
export function useWordPages(request: WordListRequest) {
  const first = useLiveQuery(
    () => wordPage({ ...request, cursor: null }),
    [request.query, request.filter, request.lessonId],
  );
  const [more, setMore] = useState<WordPage[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setMore([]);
  }, [request.query, request.filter, request.lessonId]);
  const last = more[more.length - 1] ?? first;
  const loadMore = useCallback(async () => {
    if (!last?.cursor || loading) return;
    setLoading(true);
    try {
      const page = await wordPage({ ...request, cursor: last.cursor });
      setMore((pages) => [...pages, page]);
    } finally {
      setLoading(false);
    }
  }, [last?.cursor, loading, request.query, request.filter, request.lessonId]);
  return {
    items: first ? [...first.items, ...more.flatMap((page) => page.items)] : [],
    ready: !!first,
    hasMore: !!last?.cursor,
    loading,
    loadMore,
    scope: first?.scope ?? "all",
  };
}
