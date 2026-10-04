import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import {
  applyPackage,
  catalogPhase,
  contentUrl,
  coursePhase,
  downloadLessonMedia,
  ensureAsset,
  installCourse,
  installLesson,
  lessonOfWord,
  lessonReadiness,
  previewPackage,
  refreshCatalog,
  resetCatalogPhase,
  resetPreviews,
  subscribeCatalog,
  syncCourses,
  wordFromPackage,
} from "../src/content/client";
import { ContentError, type ContentPackage } from "../src/content/schema";
import { revisionOf } from "../content/build";
import { saveNewItemsPerDay } from "../src/storage/ops";
import { dexieSource, lessonItems } from "../src/storage/queries";
import { makePlan } from "../src/domain/learning";
import { indexWord } from "../src/storage/db";
import { wordKeyOf, wordRef, wordState } from "./helpers/cards";
import {
  completeLessons,
  content,
  installLessons,
  itemCountOf,
  memoryFetcher,
  packageOf,
  wordCountOf,
} from "./helpers/content";
import { buildMixed, installMixed, MIXED_LESSON, MIXED_PHRASES, mixedContent, mixedPackage } from "./helpers/mixed";
import { unitKey } from "./helpers/cards";
import { phraseRevisionOf } from "../content/build";

let db: AppDatabase;
beforeEach(async () => {
  await new AppDatabase("tetradio-content").delete();
  db = new AppDatabase("tetradio-content");
  await db.open();
});
const entry = (id: string) => content.catalog.lessons.find((l) => l.id === id)!;
/** Новая версия пакета: изменённые слова получают новую ревизию, как это сделал бы генератор. */
function bump(pack: ContentPackage, change: (words: ContentPackage["words"]) => void): ContentPackage {
  const words = pack.words.map((word) => ({ ...word }));
  change(words);
  return {
    ...pack,
    version: `${pack.version}-next`,
    words: words.map((word) => ({ ...word, revision: revisionOf(word) })),
  };
}
function withUpdate(id: string, next: ContentPackage) {
  const url = `content/packages/${id}@${next.version}.json`;
  const catalog = {
    ...content.catalog,
    lessons: content.catalog.lessons.map((l) => (l.id === id ? { ...l, version: next.version, url } : l)),
  };
  return memoryFetcher(content, { "content/catalog.json": catalog, [url]: next });
}
/** Каталог уже знает о новой версии: так выглядит обновление после фонового refreshCatalog. */
async function upgrade(id: string, next: ContentPackage) {
  const fetcher = withUpdate(id, next);
  await refreshCatalog(db, fetcher);
  return fetcher;
}

describe("курсы", () => {
  it("установка запоминает курс урока и в уроке, и в пакете", async () => {
    await installLessons(db, ["mech-3"]);
    expect((await db.lessons.get("mech-3"))!.courseId).toBe("mechanics");
    expect((await db.packages.get("mech-3"))!.courseId).toBe("mechanics");
  });
  it("обновление проставляет курс уроку, установленному без него", async () => {
    await installLessons(db, ["mech-2"]);
    await db.lessons.update("mech-2", { courseId: undefined }); // база после перехода на курсы
    await applyPackage(packageOf("mech-2"), db);
    expect((await db.lessons.get("mech-2"))!.courseId).toBe("mechanics");
  });
  it("обновление каталога заводит курсы и проставляет курс урокам, установленным без него", async () => {
    await installLessons(db, ["mech-1"]);
    await db.lessons.update("mech-1", { courseId: undefined });
    await db.courses.clear();
    await refreshCatalog(db, memoryFetcher());
    expect((await db.lessons.get("mech-1"))!.courseId).toBe("mechanics");
    expect(await db.courses.get("mechanics")).toMatchObject({ title: "Механики", newItemsPerDay: 12 });
  });
  it("новый курс получает предел новых карточек по умолчанию, а сохранённый предел обновление не трогает", async () => {
    await refreshCatalog(db, memoryFetcher());
    expect((await db.courses.get("mechanics"))!.newItemsPerDay).toBe(12);
    await saveNewItemsPerDay("mechanics", 7, db);
    await refreshCatalog(db, memoryFetcher());
    expect((await db.courses.get("mechanics"))!.newItemsPerDay).toBe(7);
  });
  it("повторное обновление неизменного каталога курс не переписывает", async () => {
    await refreshCatalog(db, memoryFetcher());
    const first = await db.courses.get("mechanics");
    await refreshCatalog(db, memoryFetcher());
    expect(await db.courses.count()).toBe(1);
    expect(await db.courses.get("mechanics")).toEqual(first);
  });
});

describe("загрузка курса", () => {
  const packs = (fetcher: { requests: string[] }) => fetcher.requests.filter((url) => url.includes("/packages/"));
  const media = (fetcher: { requests: string[] }) => fetcher.requests.filter((url) => url.includes("/media/"));
  it("«Учить курс» ставит все уроки курса и не трогает медиа", async () => {
    const fetcher = memoryFetcher();
    await refreshCatalog(db, fetcher);
    const result = await installCourse("mechanics", db, fetcher);
    expect(result.installed).toBe(content.catalog.lessons.length);
    expect(await db.packages.count()).toBe(content.catalog.lessons.length);
    expect(media(fetcher)).toEqual([]);
  });
  it("начатый курс сам доустанавливает недостающее и подтягивает версию", async () => {
    const first = memoryFetcher();
    await refreshCatalog(db, first);
    await installLesson("mech-1", db, first);
    const next = bump(packageOf("mech-1"), (words) => {
      words[0].russian = "новый перевод";
    });
    const fetcher = await upgrade("mech-1", next);
    fetcher.requests.length = 0;
    await syncCourses(db, fetcher);
    expect(await db.packages.count()).toBe(content.catalog.lessons.length);
    expect((await db.packages.get("mech-1"))!.version).toBe(next.version);
    expect(media(fetcher)).toEqual([]);
  });
  it("курс, чьи уроки пришли с другого устройства и ждут установки, догружается сам", async () => {
    const fetcher = memoryFetcher();
    await refreshCatalog(db, fetcher);
    const lesson = { id: "mech-2", targetDate: null, status: "completed", updatedAt: "2026-09-16T07:00:00.000Z" };
    await db.meta.put({ key: "sync:pendingLessons", value: JSON.stringify({ "mech-2": lesson }) });
    await syncCourses(db, fetcher);
    expect(await db.packages.count()).toBe(content.catalog.lessons.length);
    expect(await db.lessons.get("mech-2")).toMatchObject({ completed: true });
  });
  it("курс без единого урока сам не качается", async () => {
    const fetcher = memoryFetcher();
    await refreshCatalog(db, fetcher);
    fetcher.requests.length = 0;
    await syncCourses(db, fetcher);
    expect(packs(fetcher)).toEqual([]);
    expect(await db.packages.count()).toBe(0);
  });
  it("ошибка сети оставляет прежние версии и сообщается на уровне курса", async () => {
    const ok = memoryFetcher();
    await refreshCatalog(db, ok);
    await installLesson("mech-1", db, ok);
    const broken = memoryFetcher();
    broken.json = async (url) => {
      if (url.includes("/packages/")) throw new ContentError("Нет сети", "network");
      return content.catalog;
    };
    await syncCourses(db, broken);
    expect(await db.packages.count()).toBe(1);
    expect(coursePhase("mechanics")).toMatchObject({ phase: "error", kind: "network" });
    await syncCourses(db, memoryFetcher());
    expect(coursePhase("mechanics")).toEqual({ phase: "idle" });
    expect(await db.packages.count()).toBe(content.catalog.lessons.length);
  });
});

describe("каталог", () => {
  it("запуск читает только каталог: ни одного пакета и медиа", async () => {
    const fetcher = memoryFetcher();
    await refreshCatalog(db, fetcher);
    expect(fetcher.requests).toEqual(["content/catalog.json"]);
    expect(await db.catalog.count()).toBe(content.catalog.lessons.length);
    expect(await db.words.count()).toBe(0);
    expect(await db.packages.count()).toBe(0);
  });
  it("ошибка сети оставляет прежний каталог и установленные уроки", async () => {
    await installLessons(db, ["mech-2"]);
    const broken = memoryFetcher(content, { "content/catalog.json": undefined });
    broken.json = async () => {
      throw new ContentError("Нет сети", "network");
    };
    await expect(refreshCatalog(db, broken)).rejects.toThrow("Нет сети");
    expect(await db.catalog.count()).toBe(content.catalog.lessons.length);
    expect(await db.words.count()).toBe(wordCountOf("mech-2"));
  });
  it("каталог неподдерживаемой схемы отклоняется без изменения кеша", async () => {
    await refreshCatalog(db, memoryFetcher());
    await expect(
      refreshCatalog(db, memoryFetcher(content, { "content/catalog.json": { ...content.catalog, schemaVersion: 1 } })),
    ).rejects.toMatchObject({ kind: "unsupported" });
    expect(await db.catalog.count()).toBe(content.catalog.lessons.length);
  });
});

describe("установка урока", () => {
  it("открытие урока загружает только его пакет и сохраняет слова со связями по порядку", async () => {
    const fetcher = memoryFetcher();
    await refreshCatalog(db, fetcher);
    const result = await installLesson("mech-2", db, fetcher);
    expect(result).toMatchObject({ status: "installed", added: wordCountOf("mech-2") });
    expect(fetcher.requests).toEqual(["content/catalog.json", entry("mech-2").url]);
    expect(await db.words.count()).toBe(wordCountOf("mech-2"));
    expect((await lessonItems("mech-2", db)).map((l) => l.ref.id)).toEqual(
      packageOf("mech-2").items.map((item) => item.id),
    );
    expect(await db.lessons.get("mech-2")).toMatchObject({
      title: "Урок 1.2",
      completed: false,
    });
    expect(await db.assets.count()).toBe(0); // медиа не скачиваются вместе с пакетом
    expect(await db.media.count()).toBe(packageOf("mech-2").media.length);
    const word = (await db.words.get("w034"))!;
    expect(word).toMatchObject({
      greek: "ο φίλος",
      revision: packageOf("mech-2").words.find((w) => w.id === "w034")!.revision,
    });
    expect(word.tokens).toContain("φιλος");
  });
  it("пакеты 1.1 и 1.2 дают все свои слова и непройденные уроки", async () => {
    await installLessons(db, ["mech-1", "mech-2"]);
    expect(await db.words.count()).toBe(wordCountOf("mech-1", "mech-2"));
    expect(await db.lessons.get("mech-1")).toMatchObject({ completed: false });
    expect(await db.lessons.get("mech-2")).toMatchObject({ completed: false });
    expect(await db.events.count()).toBe(0);
    expect(await db.cardStates.count()).toBe(0);
  });
  it("общее слово двух уроков — одна запись и две связи", async () => {
    await installLessons(db, ["mech-2", "mech-3"]);
    expect(await db.words.where("greek").equals("ο φίλος").toArray()).toHaveLength(1);
    expect(await db.lessonItems.where("unitKey").equals(wordKeyOf("w034")).count()).toBe(2);
    expect(await db.words.count()).toBe(wordCountOf("mech-2", "mech-3"));
  });
  it("одновременные запросы одного пакета объединяются, повторная установка ничего не дублирует", async () => {
    const fetcher = memoryFetcher();
    await refreshCatalog(db, fetcher);
    const [a, b] = await Promise.all([installLesson("mech-1", db, fetcher), installLesson("mech-1", db, fetcher)]);
    expect(a).toBe(b);
    expect(fetcher.requests.filter((url) => url.includes("mech-1"))).toHaveLength(1);
    expect(await installLesson("mech-1", db, fetcher)).toMatchObject({ status: "current" });
    expect(await db.words.count()).toBe(wordCountOf("mech-1"));
    expect(await db.lessonItems.count()).toBe(itemCountOf("mech-1"));
    expect(await db.packages.count()).toBe(1);
  });
  it("повреждённый, чужой и несовместимый пакет отклоняются без частичного урока", async () => {
    const url = entry("mech-1").url;
    const pack = packageOf("mech-1");
    for (const [bad, pattern] of [
      [{ ...pack, schemaVersion: 99 }, /не поддерживается/],
      [{ ...pack, words: pack.words.slice(1) }, /которой нет в пакете/],
      [{ ...pack, version: "другая" }, /не соответствует записи каталога/],
      [42, /ожидался объект/],
    ] as const) {
      const fetcher = memoryFetcher(content, { [url]: bad });
      await refreshCatalog(db, fetcher);
      await expect(installLesson("mech-1", db, fetcher)).rejects.toThrow(pattern);
      expect(await db.words.count()).toBe(0);
      expect(await db.lessonItems.count()).toBe(0);
      expect(await db.packages.count()).toBe(0);
      expect(await db.lessons.count()).toBe(0);
    }
  });
  it("ошибка записи откатывает слова, связи и версию целиком, прежняя установка сохраняется", async () => {
    await installLessons(db, ["mech-2"]);
    const before = await db.packages.get("mech-2");
    const next = bump(packageOf("mech-2"), (words) => {
      words[0].russian = "иначе";
    });
    const fail = () => {
      throw Object.assign(new Error("QuotaExceededError"), { name: "QuotaExceededError" });
    };
    db.packages.hook("updating", fail);
    await expect(installLesson("mech-2", db, await upgrade("mech-2", next))).rejects.toMatchObject({
      kind: "storage",
    });
    db.packages.hook("updating").unsubscribe(fail);
    expect(await db.packages.get("mech-2")).toEqual(before);
    expect((await db.words.get(next.words[0].id))!.russian).not.toBe("иначе");
  });
  it("без сети неустановленный урок даёт понятную ошибку сети, а установленные продолжают работать", async () => {
    const fetcher = await installLessons(db, ["mech-1"]);
    fetcher.json = async (url) => {
      if (url.endsWith("catalog.json")) return content.catalog;
      throw new ContentError("Нет сети: пакет урока ещё не загружен на это устройство.", "network");
    };
    await expect(installLesson("mech-2", db, fetcher)).rejects.toMatchObject({ kind: "network" });
    expect(await db.words.count()).toBe(wordCountOf("mech-1"));
    expect(await db.lessons.count()).toBe(1);
  });
});

describe("обновление пакета", () => {
  it("слово обновляется по новой ревизии, ID и прогресс сохраняются", async () => {
    const fetcher = await installLessons(db, ["mech-2"]);
    await db.cardStates.add(
      wordState("w034", {
        card: { due: new Date("2026-09-20") } as never,
        introducedAt: "2026-09-10T00:00:00Z",
        version: 3,
      }),
    );
    const next = bump(packageOf("mech-2"), (words) => {
      words.find((w) => w.id === "w034")!.russian = "друг, приятель";
    });
    const result = await installLesson("mech-2", db, await upgrade("mech-2", next));
    expect(result).toMatchObject({ status: "updated", added: 0, changed: 1 });
    expect(fetcher.requests.filter((url) => url.includes("media"))).toHaveLength(0);
    const updated = (await db.words.get("w034"))!;
    expect(updated.russian).toBe("друг, приятель");
    expect((await db.cardStates.get(wordKeyOf("w034")))!.version).toBe(3);
    expect((await db.packages.get("mech-2"))!.version).toBe(next.version);
  });
  it("разметка слов примера приходит с новой версией пакета и сохраняется в слове", async () => {
    await installLessons(db, ["mech-2"]);
    const glosses = [
      { start: 2, length: 5, russian: "друг", wordId: "w034" },
      { start: 8, length: 3, russian: "наш" },
    ];
    const next = bump(packageOf("mech-2"), (words) => {
      const friend = words.find((w) => w.id === "w034")!;
      friend.examples = [{ ...friend.examples[0], glosses }];
    });
    const result = await installLesson("mech-2", db, await upgrade("mech-2", next));
    expect(result).toMatchObject({ status: "updated", changed: 1 });
    expect((await db.words.get("w034"))!.examples[0].glosses).toEqual(glosses);
  });
  it("новая ревизия перезаписывает поставляемые поля целиком, даже исправленные прежней версией", async () => {
    await installLessons(db, ["mech-2"]);
    const created = (await db.words.get("w034"))!.createdAt;
    await db.words.update("w034", { russian: "дом (старая правка)" });
    const next = bump(packageOf("mech-2"), (words) => {
      const w = words.find((w) => w.id === "w034")!;
      w.russian = "жилище";
      w.note = "новая заметка";
    });
    const result = await installLesson("mech-2", db, await upgrade("mech-2", next));
    expect(result).toMatchObject({ status: "updated", changed: 1 });
    expect(await db.words.get("w034")).toMatchObject({ russian: "жилище", note: "новая заметка", createdAt: created });
  });
  it("автор убрал карточку из урока: связь исчезает, карточка с прогрессом остаётся в словаре, название урока не перезаписывается", async () => {
    await installLessons(db, ["mech-2"]);
    await db.lessons.update("mech-2", { title: "Мой урок" });
    const pack = packageOf("mech-2");
    const dropped = pack.words[0].id;
    await db.cardStates.add(
      wordState(dropped, {
        card: { due: new Date("2026-09-20") } as never,
        introducedAt: "2026-09-10T00:00:00Z",
        version: 3,
      }),
    );
    // Своё слово, добавленное в поставляемый урок прежней версией: оно не из пакета и обновлением не трогается.
    const own = {
      id: "w-own",
      greek: "η καρέκλα",
      russian: "стул",
      ipa: "",
      segments: [],
      examples: [],
      verified: false,
      createdAt: "2026-09-16T10:00:00.000Z",
      updatedAt: "2026-09-16T10:00:00.000Z",
    };
    await db.words.add(indexWord(own));
    await db.lessonItems.add({
      lessonId: "mech-2",
      unitKey: wordKeyOf("w-own"),
      ref: wordRef("w-own"),
      position: itemCountOf("mech-2"),
    });
    const next: ContentPackage = {
      ...pack,
      version: "trimmed",
      lesson: { ...pack.lesson, title: "Другое название" },
      words: pack.words.slice(1),
      items: pack.items.slice(1).map((item, i) => ({ ...item, position: i })),
      media: pack.media.filter((item) => item.id !== pack.words[0].imageAssetId),
    };
    await installLesson("mech-2", db, await upgrade("mech-2", next));
    expect(await db.words.get(dropped)).toBeTruthy(); // из словаря слово не исчезает
    expect((await db.cardStates.get(wordKeyOf(dropped)))!.version).toBe(3); // прогресс и история сохранены
    expect(await db.lessonItems.get(["mech-2", wordKeyOf(dropped)])).toBeUndefined(); // состав урока принадлежит автору
    expect(await db.lessonItems.get(["mech-2", wordKeyOf("w-own")])).toBeTruthy(); // добавленное пользователем осталось
    expect(await lessonItems("mech-2", db)).toHaveLength(pack.items.length); // минус убранная автором, плюс своя
    expect(await db.lessons.get("mech-2")).toMatchObject({ title: "Мой урок" });
  });
  it("слово, убранное автором из пройденного урока, не попадает в новые карточки", async () => {
    await installLessons(db, ["mech-2"]);
    await completeLessons(db, ["mech-2"]);
    await db.courses.update("mechanics", { newItemsPerDay: 100 });
    const pack = packageOf("mech-2");
    const dropped = pack.words[0].id;
    const next: ContentPackage = {
      ...pack,
      version: "trimmed",
      words: pack.words.slice(1),
      items: pack.items.slice(1).map((item, i) => ({ ...item, position: i })),
    };
    await installLesson("mech-2", db, await upgrade("mech-2", next));
    expect(await db.words.get(dropped)).toBeTruthy();
    const plan = await makePlan(dexieSource(db), new Date("2026-09-19T09:00:00Z"));
    expect(plan.newRefs).toHaveLength(pack.items.length - 1);
    expect(plan.newRefs.map((ref) => ref.id)).not.toContain(dropped);
  });
  it("карточка, убранная автором из одного урока, остаётся в другом и возвращается вместе с новой версией", async () => {
    await installLessons(db, ["mech-2", "mech-3"]);
    const pack = packageOf("mech-2");
    const shared = "w034"; // это слово входит и в урок 1.3
    const without = {
      ...pack,
      version: "no-shared",
      words: pack.words.filter((word) => word.id !== shared),
      items: pack.items.filter((item) => item.id !== shared).map((item, i) => ({ ...item, position: i })),
    };
    await installLesson("mech-2", db, await upgrade("mech-2", without));
    expect(await db.lessonItems.get(["mech-2", wordKeyOf(shared)])).toBeUndefined();
    expect(await db.lessonItems.get(["mech-3", wordKeyOf(shared)])).toBeTruthy(); // другой урок не затронут
    // Автор вернул карточку — связь появляется снова.
    const back = { ...pack, version: "shared-back" };
    await installLesson("mech-2", db, await upgrade("mech-2", back));
    expect(await db.lessonItems.get(["mech-2", wordKeyOf(shared)])).toBeTruthy();
  });
  it("пакет с ревизией той же версии, установленный из другой вкладки, не применяется второй раз", async () => {
    await installLessons(db, ["mech-1"]);
    expect(await applyPackage(packageOf("mech-1"), db)).toMatchObject({ status: "current" });
  });
});

describe("медиа и готовность офлайн", () => {
  it("картинка скачивается при первом обращении и потом читается из базы", async () => {
    const fetcher = await installLessons(db, ["mech-2"]);
    const before = fetcher.requests.length;
    const asset = await ensureAsset("img-w034", db, fetcher);
    expect(asset).toMatchObject({ kind: "image", mimeType: "image/svg+xml" });
    expect(await asset!.blob.text()).toContain("<svg");
    await ensureAsset("img-w034", db, fetcher);
    expect(fetcher.requests.length).toBe(before + 1);
    expect(await ensureAsset("img-нет", db, fetcher)).toBeNull();
  });
  it("новая версия файла под тем же id перекачивается; без сети остаётся прежняя", async () => {
    const fetcher = await installLessons(db, ["mech-2"]);
    const old = await ensureAsset("img-w034", db, fetcher);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
    const ref = (await db.media.get("img-w034"))!;
    await db.media.put({ ...ref, url: ref.url.replace(/\.svg$/, "-v2.svg"), bytes: new Blob([svg]).size });
    const offline = { ...fetcher, blob: async () => Promise.reject(new Error("offline")) };
    expect(await (await ensureAsset("img-w034", db, offline))!.blob.text()).toBe(await old!.blob.text());
    const online = { ...fetcher, blob: async () => new Blob([svg]) };
    const fresh = await ensureAsset("img-w034", db, online);
    expect(await fresh!.blob.text()).toBe(svg);
    expect((await db.assets.get("img-w034"))!.url).toMatch(/-v2\.svg$/);
  });
  it("слова доступны локально, но урок не готов офлайн, пока обязательное медиа не скачано; повтор докачивает", async () => {
    const fetcher = await installLessons(db, ["mech-2"]);
    expect(await lessonReadiness("mech-2", db)).toMatchObject({
      installed: true,
      required: packageOf("mech-2").media.length,
      present: 0,
      updateAvailable: false,
    });
    const media = packageOf("mech-2").media[0];
    const flaky = memoryFetcher(content, { [media.url]: new Blob(["<svg"], { type: "image/svg+xml" }) }); // повреждённый файл
    const first = await downloadLessonMedia("mech-2", db, flaky);
    expect(first).toMatchObject({ fetched: packageOf("mech-2").media.length - 1, failed: [media.id] });
    expect((await lessonReadiness("mech-2", db)).missing).toEqual([media.id]);
    const second = await downloadLessonMedia("mech-2", db, fetcher);
    expect(second).toEqual({ fetched: 1, failed: [] });
    expect((await lessonReadiness("mech-2", db)).missing).toEqual([]);
    expect(await db.assets.count()).toBe(packageOf("mech-2").media.length);
  });
  it("нехватка места при сохранении медиа поднимает ошибку хранилища, а не ложный успех", async () => {
    const fetcher = await installLessons(db, ["mech-2"]);
    const fail = () => {
      throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    };
    db.assets.hook("creating", fail);
    await expect(downloadLessonMedia("mech-2", db, fetcher)).rejects.toMatchObject({ kind: "storage" });
    db.assets.hook("creating").unsubscribe(fail);
    expect(await db.assets.count()).toBe(0);
  });
  it("новая версия в каталоге показывается как доступное обновление, а не применяется сама", async () => {
    await installLessons(db, ["mech-2"]);
    const next = bump(packageOf("mech-2"), (words) => {
      words[0].russian = "иначе";
    });
    await refreshCatalog(db, withUpdate("mech-2", next));
    expect((await lessonReadiness("mech-2", db)).updateAvailable).toBe(true);
    expect((await db.packages.get("mech-2"))!.version).toBe(packageOf("mech-2").version);
  });
});

describe("установка и обновление смешанного пакета", () => {
  it("ставит слова, фразы и связи атомарно в авторском порядке; повторный запрос объединяется", async () => {
    const fetcher = memoryFetcher(mixedContent());
    await refreshCatalog(db, fetcher);
    const [a, b] = await Promise.all([
      installLesson(MIXED_LESSON, db, fetcher),
      installLesson(MIXED_LESSON, db, fetcher),
    ]);
    expect(a).toBe(b);
    expect(a).toMatchObject({ status: "installed", added: 7 });
    const pack = mixedPackage();
    expect((await lessonItems(MIXED_LESSON, db)).map((item) => [item.ref.kind, item.ref.id])).toEqual(
      pack.items.map((item) => [item.kind, item.id]),
    );
    expect(await db.phrases.count()).toBe(6);
    expect(await db.words.count()).toBe(1);
    expect((await db.phrases.get("p-grafo"))!).toMatchObject({
      text: "Γράφω ένα γράμμα.",
      translation: "Я пишу письмо.",
      revision: pack.phrases[0].revision,
    });
    expect((await db.phrases.get("p-oikogeneia"))!.note).toBe("Притяжательное μου стоит после существительного.");
    expect(await db.packages.get(MIXED_LESSON)).toMatchObject({
      version: pack.version,
      phrases: pack.phrases,
    });
    expect(await db.catalog.get(MIXED_LESSON)).toMatchObject({ wordCount: 1, phraseCount: 6, cardCount: 7 });
    expect(await installLesson(MIXED_LESSON, db, fetcher)).toMatchObject({ status: "current" });
    expect(await db.lessonItems.count()).toBe(7);
  });
  it("повреждена только фраза или состав ссылается на снятый вид — отклоняется весь пакет", async () => {
    const pack = mixedPackage();
    const url = mixedContent().catalog.lessons.find((l) => l.id === MIXED_LESSON)!.url;
    for (const [bad, pattern] of [
      [{ ...pack, phrases: pack.phrases.map((p) => (p.id === "p-grafo" ? { ...p, text: "" } : p)) }, /нет текста/],
      [{ ...pack, items: [...pack.items, { kind: "phrase", id: "нет", position: 99 }] }, /которой нет в пакете/],
      // Пакет прежней версии со снятым видом карточек: частичная установка хуже отказа.
      [{ ...pack, items: [...pack.items, { kind: "cloze", id: "c-grafo", position: 99 }] }, /вид карточки/],
    ] as const) {
      const fetcher = memoryFetcher(mixedContent(), { [url]: bad });
      await refreshCatalog(db, fetcher);
      await expect(installLesson(MIXED_LESSON, db, fetcher)).rejects.toThrow(pattern);
      expect(await db.words.count()).toBe(0);
      expect(await db.phrases.count()).toBe(0);
      expect(await db.lessonItems.count()).toBe(0);
      expect(await db.packages.count()).toBe(0);
    }
  });
  it("нехватка места откатывает фразы, связи и версию; прежняя установленная ревизия остаётся", async () => {
    await installMixed(db);
    const before = {
      pack: await db.packages.get(MIXED_LESSON),
      phrase: await db.phrases.get("p-grafo"),
      items: await db.lessonItems.count(),
    };
    const pack = mixedPackage();
    const next = {
      ...pack,
      version: `${pack.version}-next`,
      phrases: pack.phrases.map((p) => (p.id === "p-grafo" ? { ...p, note: "Иначе", revision: "r-next" } : p)),
    };
    const url = `content/packages/${MIXED_LESSON}@${next.version}.json`;
    const catalog = {
      ...mixedContent().catalog,
      lessons: mixedContent().catalog.lessons.map((l) =>
        l.id === MIXED_LESSON ? { ...l, version: next.version, url } : l,
      ),
    };
    const fetcher = memoryFetcher(mixedContent(), { "content/catalog.json": catalog, [url]: next });
    await refreshCatalog(db, fetcher);
    const fail = () => {
      throw Object.assign(new Error("QuotaExceededError"), { name: "QuotaExceededError" });
    };
    db.packages.hook("updating", fail);
    await expect(installLesson(MIXED_LESSON, db, fetcher)).rejects.toMatchObject({ kind: "storage" });
    db.packages.hook("updating").unsubscribe(fail);
    expect(await db.packages.get(MIXED_LESSON)).toEqual(before.pack);
    expect(await db.phrases.get("p-grafo")).toEqual(before.phrase);
    expect(await db.lessonItems.count()).toBe(before.items);
  });
  it("обновление сохраняет ID, прогресс и прохождение урока; правка фразы меняет её ревизию", async () => {
    await installMixed(db);
    await db.lessons.update(MIXED_LESSON, { completed: true, updatedAt: "2026-09-18T10:00:00.000Z" });
    await db.cardStates.add({
      unitKey: unitKey({ kind: "phrase", id: "p-paidi" }),
      ref: { kind: "phrase", id: "p-paidi" },
      card: { due: new Date("2026-09-20") } as never,
      introducedAt: "2026-09-10T00:00:00Z",
      version: 2,
    });
    const pack = mixedPackage();
    const paidi = pack.phrases.find((p) => p.id === "p-paidi")!;
    const { revision: _r, ...fields } = paidi;
    const fixed = { ...fields, usage: "Описание сцены" };
    const next = {
      ...pack,
      version: `${pack.version}-next`,
      lesson: { title: "Другое название" },
      phrases: pack.phrases.map((p) => (p.id === "p-paidi" ? { ...fixed, revision: phraseRevisionOf(fixed) } : p)),
    };
    const url = `content/packages/${MIXED_LESSON}@${next.version}.json`;
    const catalog = {
      ...mixedContent().catalog,
      lessons: mixedContent().catalog.lessons.map((l) =>
        l.id === MIXED_LESSON ? { ...l, version: next.version, url } : l,
      ),
    };
    const fetcher = memoryFetcher(mixedContent(), { "content/catalog.json": catalog, [url]: next });
    await refreshCatalog(db, fetcher);
    const result = await installLesson(MIXED_LESSON, db, fetcher);
    expect(result).toMatchObject({ status: "updated", added: 0, changed: 1 });
    const stored = (await db.phrases.get("p-paidi"))!;
    expect(stored.usage).toBe("Описание сцены");
    expect(stored.revision).not.toBe(paidi.revision);
    expect((await db.cardStates.get(unitKey({ kind: "phrase", id: "p-paidi" })))!.version).toBe(2); // состояние и ключ не тронуты
    expect(await db.lessons.get(MIXED_LESSON)).toMatchObject({
      completed: true,
      updatedAt: "2026-09-18T10:00:00.000Z",
    });
    expect(stored).not.toHaveProperty("provenance");
  });
  it("автор убрал фразу из состава: связь исчезает, карточка и её прогресс остаются", async () => {
    await installMixed(db);
    await db.cardStates.add({
      unitKey: unitKey({ kind: "phrase", id: "p-lemeso" }),
      ref: { kind: "phrase", id: "p-lemeso" },
      card: { due: new Date("2026-09-20") } as never,
      introducedAt: "2026-09-10T00:00:00Z",
      version: 5,
    });
    const pack = mixedPackage();
    const next = {
      ...pack,
      version: `${pack.version}-trim`,
      phrases: pack.phrases.filter((phrase) => phrase.id !== "p-lemeso"),
      items: pack.items.filter((item) => item.id !== "p-lemeso").map((item, index) => ({ ...item, position: index })),
    };
    const url = `content/packages/${MIXED_LESSON}@${next.version}.json`;
    const catalog = {
      ...mixedContent().catalog,
      lessons: mixedContent().catalog.lessons.map((l) =>
        l.id === MIXED_LESSON ? { ...l, version: next.version, url } : l,
      ),
    };
    const fetcher = memoryFetcher(mixedContent(), { "content/catalog.json": catalog, [url]: next });
    await refreshCatalog(db, fetcher);
    await installLesson(MIXED_LESSON, db, fetcher);
    expect(await db.lessonItems.get([MIXED_LESSON, unitKey({ kind: "phrase", id: "p-lemeso" })])).toBeUndefined();
    expect(await db.phrases.get("p-lemeso")).toBeTruthy(); // карточка остаётся ради истории и прогресса
    expect((await db.cardStates.get(unitKey({ kind: "phrase", id: "p-lemeso" })))!.version).toBe(5);
    expect(await db.lessonItems.where("lessonId").equals(MIXED_LESSON).count()).toBe(next.items.length);
    expect((await db.packages.get(MIXED_LESSON))!.items.map((item) => item.id)).not.toContain("p-lemeso");
  });
  it("урок только из текстовых заданий готов офлайн без обязательных медиа", async () => {
    await installMixed(db);
    const readiness = await lessonReadiness(MIXED_LESSON, db);
    // Обязательное медиа даёт только слово с картинкой; у фраз файлов нет — они не блокируют готовность.
    expect(readiness.installed).toBe(true);
    expect(readiness.required).toBe((await db.packages.get(MIXED_LESSON))!.media.filter((m) => m.required).length);
    const noWords = buildMixed({
      phrases: { "p-grafo": MIXED_PHRASES["p-grafo"], "p-xora": MIXED_PHRASES["p-xora"] },
      lesson: {
        title: "Текст",
        language: "el",
        items: [
          { kind: "phrase", id: "p-grafo" },
          { kind: "phrase", id: "p-xora" },
        ],
      },
    });
    const other = new AppDatabase("tetradio-content-text");
    await other.delete();
    await other.open();
    await installMixed(other, [MIXED_LESSON], noWords);
    expect(await lessonReadiness(MIXED_LESSON, other)).toMatchObject({
      installed: true,
      required: 0,
      present: 0,
      missing: [],
    });
    other.close();
  });
});

describe("адрес контента", () => {
  it("база с косой чертой и без неё даёт один адрес без двойной черты", () => {
    expect(contentUrl("content/catalog.json", "/")).toBe("/content/catalog.json");
    expect(contentUrl("content/catalog.json", "/tetradio")).toBe("/tetradio/content/catalog.json");
    expect(contentUrl("content/catalog.json", "/tetradio/")).toBe("/tetradio/content/catalog.json");
  });
});

describe("готовность каталога", () => {
  beforeEach(() => resetCatalogPhase());
  const failing = () => {
    const broken = memoryFetcher();
    broken.json = async () => {
      throw new ContentError("Нет сети", "network");
    };
    return broken;
  };
  it("до первой загрузки — загрузка, после успеха — готов", async () => {
    expect(catalogPhase()).toBe("loading");
    await refreshCatalog(db, memoryFetcher());
    expect(catalogPhase()).toBe("ready");
  });
  it("ошибка до первого успеха — сбой, повтор снова ждёт и завершается готовностью", async () => {
    await expect(refreshCatalog(db, failing())).rejects.toThrow();
    expect(catalogPhase()).toBe("error");
    const retry = refreshCatalog(db, memoryFetcher());
    expect(catalogPhase()).toBe("loading");
    await retry;
    expect(catalogPhase()).toBe("ready");
  });
  it("повторное обновление после готовности не возвращает загрузку, его сбой не сбрасывает готовность", async () => {
    await refreshCatalog(db, memoryFetcher());
    const seen: string[] = [];
    const off = subscribeCatalog(() => seen.push(catalogPhase()));
    const again = refreshCatalog(db, memoryFetcher());
    expect(catalogPhase()).toBe("ready");
    await again;
    await expect(refreshCatalog(db, failing())).rejects.toThrow();
    expect(catalogPhase()).toBe("ready");
    off();
    expect(seen).toEqual([]);
  });
});

describe("урок слова по каталогу", () => {
  const lesson = (id: string, wordIds?: string[]) => ({ ...content.catalog.lessons[0], id, wordIds });
  const withLessons = (lessons: ReturnType<typeof lesson>[]) =>
    memoryFetcher(content, { "content/catalog.json": { ...content.catalog, lessons } });
  it("слово одного урока находится по индексу", async () => {
    await refreshCatalog(db, memoryFetcher());
    expect((await lessonOfWord("w093", db))?.id).toBe("mech-4");
  });
  it("из нескольких уроков берётся первый в порядке каталога, а не по идентификатору", async () => {
    await refreshCatalog(db, withLessons([lesson("lesson-2-1", ["w1", "w2"]), lesson("lesson-10-1", ["w2"])]));
    expect((await db.catalog.toArray()).map((entry) => entry.id)).toEqual(["lesson-10-1", "lesson-2-1"]);
    expect((await lessonOfWord("w2", db))?.id).toBe("lesson-2-1");
  });
  it("записи без положения идут в конец, затем по идентификатору", async () => {
    await db.catalog.bulkAdd([lesson("b", ["w"]), lesson("a", ["w"]), { ...lesson("z", ["w"]), position: 0 }]);
    expect((await lessonOfWord("w", db))?.id).toBe("z");
    await db.catalog.delete("z");
    expect((await lessonOfWord("w", db))?.id).toBe("a");
  });
  it("отсутствующее слово и каталог без индекса дают null", async () => {
    await refreshCatalog(db, memoryFetcher());
    expect(await lessonOfWord("w99-99", db)).toBeNull();
    await refreshCatalog(db, withLessons([lesson("mech-4")]));
    expect(await lessonOfWord("w093", db)).toBeNull();
  });
});

describe("просмотр пакета без установки", () => {
  beforeEach(() => resetPreviews());
  const tables = ["lessons", "words", "lessonItems", "packages", "courses", "assets", "media", "cardStates"] as const;
  const snapshot = async () =>
    Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await db[t].toArray()])));
  it("читает и проверяет пакет, ничего не записывая в базу; повтор берёт пакет из памяти", async () => {
    const fetcher = memoryFetcher();
    await refreshCatalog(db, fetcher);
    const before = await snapshot();
    const { pack, entry: found } = await previewPackage("mech-4", db, fetcher);
    expect(pack.id).toBe("mech-4");
    expect(found.version).toBe(entry("mech-4").version);
    expect(pack.words.some((word) => word.id === "w093")).toBe(true);
    await previewPackage("mech-4", db, fetcher);
    expect(fetcher.requests.filter((url) => url.includes("packages/"))).toHaveLength(1);
    expect(await snapshot()).toEqual(before);
  });
  it("сбой сети — ошибка загрузки, повтор после неё снова идёт в сеть", async () => {
    const fetcher = memoryFetcher();
    await refreshCatalog(db, fetcher);
    const offline = {
      ...fetcher,
      json: async () => {
        throw new TypeError("Failed to fetch");
      },
    };
    await expect(previewPackage("mech-4", db, offline)).rejects.toMatchObject({ kind: "network" });
    await expect(previewPackage("mech-4", db, fetcher)).resolves.toBeTruthy();
  });
  it("пакет другого урока или другой версии отклоняется", async () => {
    const fetcher = memoryFetcher();
    await refreshCatalog(db, fetcher);
    const url = entry("mech-4").url;
    const other = packageOf("mech-1");
    await expect(previewPackage("mech-4", db, memoryFetcher(content, { [url]: other }))).rejects.toThrow(
      "Пакет не соответствует записи каталога.",
    );
    await expect(
      previewPackage("mech-4", db, memoryFetcher(content, { [url]: { ...packageOf("mech-4"), version: "x" } })),
    ).rejects.toThrow("Пакет не соответствует записи каталога.");
  });
});

describe("поставляемое слово как запись", () => {
  it("берёт поставляемые поля, ревизию и даты без локальных полей", () => {
    const card = packageOf("mech-4").words.find((word) => word.id === "w093")!;
    const word = wordFromPackage(card, "2026-01-01T00:00:00.000Z");
    expect(word).toMatchObject({
      id: "w093",
      greek: card.greek,
      russian: card.russian,
      revision: card.revision,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(word).not.toHaveProperty("deletedAt");
    expect(word).not.toHaveProperty("edited");
  });
});
