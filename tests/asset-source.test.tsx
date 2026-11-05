// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wordFromPackage } from "../src/content/client";
import { PROFILES } from "../src/domain/language";
import { playWord } from "../src/shared/audio";
import { db } from "../src/storage/db";
import { packageAssetSource } from "../src/shared/store";
import { content } from "./helpers/content";

afterEach(() => vi.unstubAllGlobals());

describe("источник медиа просмотра", () => {
  it("запись слова берётся по адресу пакета, в базу медиа ничего не пишется", async () => {
    const played: string[] = [];
    vi.stubGlobal(
      "Audio",
      class extends EventTarget {
        constructor(public src: string) {
          super();
          played.push(src);
        }
        play = () => Promise.resolve();
        pause() {}
      },
    );
    const pack = content.packages.find((p) => p.id === "mech-2")!;
    const card = pack.words.find((w) => w.id === "w042")!;
    const media = pack.media.find((item) => item.id === card.audioAssetId)!;
    expect(media).toBeDefined();
    expect(await playWord(wordFromPackage(card, ""), PROFILES.el, packageAssetSource(pack))).toBe("file");
    expect(played).toEqual([`/${media.url}`]);
    expect(await db.assets.count()).toBe(0);
    expect(await db.media.count()).toBe(0);
  });
});
