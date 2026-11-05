import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonical, hash, pick } from "../content/build/common";
import { downloadLessonMedia, installLesson, refreshCatalog } from "../src/content/client";
import { parsePackage, SHIPPED_FIELDS, type PackageMedia, type PackageWord } from "../src/content/schema";
import { AppDatabase } from "../src/storage/db";
import { wordKeyOf, wordState } from "./helpers/cards";
import { content, memoryFetcher } from "./helpers/content";

type OldWord = PackageWord & { imageAssetId?: string };
/** Ревизия, как её считала сборка, пока среди поставляемых полей было `imageAssetId`. */
const oldRevisionOf = (word: OldWord) =>
  hash(canonical(pick(word, [...SHIPPED_FIELDS, "imageAssetId"] as (keyof OldWord)[])));

const pack = content.packages.find((p) => p.id === "mech-2")!;
const pictured = pack.words[0];
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
const picture: PackageMedia = {
  id: `img-${pictured.id}`,
  kind: "image",
  mimeType: "image/svg+xml",
  url: `content/media/img-${pictured.id}@1.svg`,
  bytes: new Blob([svg]).size,
  version: "1",
  required: true,
  alt: "",
  source: "Microsoft Fluent Emoji (Flat), MIT",
};
/** Пакет, сохранённый до remove-word-images: у первого слова картинка. */
const oldPack = {
  ...pack,
  version: "with-picture",
  words: pack.words.map((word) => {
    if (word.id !== pictured.id) return word;
    const old: OldWord = { ...word, imageAssetId: picture.id };
    return { ...old, revision: oldRevisionOf(old) };
  }),
  media: [...pack.media, picture],
};
const oldUrl = `content/packages/mech-2@${oldPack.version}.json`;
const oldFetcher = () =>
  memoryFetcher(content, {
    "content/catalog.json": {
      ...content.catalog,
      lessons: content.catalog.lessons.map((l) =>
        l.id === "mech-2" ? { ...l, version: oldPack.version, url: oldUrl } : l,
      ),
    },
    [oldUrl]: oldPack,
    [picture.url]: new Blob([svg], { type: picture.mimeType }),
  });

let db: AppDatabase;
beforeEach(() => {
  db = new AppDatabase(`remove-word-images-${Math.random()}`);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe("картинки слов убраны", () => {
  it("ревизия слова без картинки та же, что раньше; у слова с картинкой — новая", () => {
    // Ревизии посчитаны сборкой этой фикстуры на main до изменения.
    const before = { w009: "ea9fa52c0995", w041: "09dcdbc3d973", w044: "0b1f611fef68", w034: "afa7b32c687e" };
    const now = (id: string) => content.words.find((word) => word.id === id)!.revision;
    for (const id of ["w009", "w041", "w044"] as const) expect(now(id), id).toBe(before[id]);
    expect(now("w034")).not.toBe(before.w034);
    expect(oldPack.words[0].revision).not.toBe(pictured.revision);
  });

  it("старый пакет с картинкой разбирается, картинка в слово не попадает", () => {
    const parsed = parsePackage(oldPack);
    expect(parsed.words[0]).not.toHaveProperty("imageAssetId");
    expect(parsed.media.map((item) => item.id)).toContain(picture.id);
  });

  it("обновление урока сохраняет прогресс слова и убирает файл картинки с устройства", async () => {
    const old = oldFetcher();
    await refreshCatalog(db, old);
    await installLesson("mech-2", db, old);
    await downloadLessonMedia("mech-2", db, old);
    expect(await db.assets.get(picture.id)).toBeDefined();
    // Так запись слова сохраняла версия приложения до изменения.
    await db.words.update(pictured.id, { imageAssetId: picture.id } as never);
    await db.cardStates.put(
      wordState(pictured.id, {
        card: { due: new Date("2026-09-20") } as never,
        introducedAt: "2026-09-10T00:00:00Z",
        version: 3,
      }),
    );

    const fresh = memoryFetcher();
    await refreshCatalog(db, fresh);
    await installLesson("mech-2", db, fresh);

    expect((await db.words.get(pictured.id))!.revision).toBe(pictured.revision);
    expect(await db.words.get(pictured.id)).not.toHaveProperty("imageAssetId");
    expect((await db.cardStates.get(wordKeyOf(pictured.id)))!.version).toBe(3);
    expect(await db.assets.get(picture.id)).toBeUndefined();
    expect(await db.media.get(picture.id)).toBeUndefined();
  });
});
