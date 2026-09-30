// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WordArt } from "../src/features/words/WordCardView";
import { wordFromPackage } from "../src/content/client";
import { db } from "../src/storage/db";
import { AssetSourceContext, packageAssetSource } from "../src/shared/store";
import { content } from "./helpers/content";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("источник медиа просмотра", () => {
  it("иллюстрация берётся по адресу пакета, в базу медиа ничего не пишется", async () => {
    const pack = content.packages.find((p) => p.id === "lesson-3-4")!;
    const card = pack.words.find((w) => w.id === "w34-03")!;
    const media = pack.media.find((item) => item.id === card.imageAssetId)!;
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <AssetSourceContext.Provider value={packageAssetSource(pack)}>
          <WordArt word={wordFromPackage(card, "")} />
        </AssetSourceContext.Provider>,
      );
    });
    const img = host.querySelector("img[data-testid=word-art]");
    expect(img?.getAttribute("src")).toBe(`/${media.url}`);
    expect(await db.assets.count()).toBe(0);
    expect(await db.media.count()).toBe(0);
  });
});
