import { describe, expect, it } from "vitest";
import { checkBudgets, mp3Bitrate, type ContentBudgets } from "../content/build/budgets";
import type { Catalog } from "../src/content/schema";

/** Кадр MPEG-2 Layer III, 24 кГц, моно; индекс битрейта 4 — 32 кбит/с. */
const frame = (index: number, tail: number[] = []) =>
  new Uint8Array([0xff, 0xf3, (index << 4) | (1 << 2), 0xc4, ...tail]);
const limits: ContentBudgets = {
  packageGzip: 100,
  catalogGzip: 100,
  courseGzip: 150,
  audioBitrate: 32_000,
  audioBytes: 500,
};
const noise = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 7919 + (i >> 3) * 31) % 251);
const catalog = (lessons: { id: string; courseId: string }[]) =>
  ({
    lessons: lessons.map(({ id, courseId }) => ({ id, courseId, url: `content/packages/${id}.json` })),
  }) as unknown as Catalog;
const pack = (id: string, body: string | Uint8Array) => ({
  path: `content/packages/${id}.json`,
  body,
  mimeType: "application/json",
});

describe("битрейт mp3", () => {
  it("читает номинальный битрейт первого кадра", () => {
    expect(mp3Bitrate(frame(4))).toBe(32_000);
    expect(mp3Bitrate(frame(8))).toBe(64_000);
  });

  it("пропускает ID3v2", () => {
    const id3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 3, 1, 2, 3]);
    expect(mp3Bitrate(new Uint8Array([...id3, ...frame(4)]))).toBe(32_000);
  });

  it("у VBR берёт средний по числу кадров, а не номинал Xing-кадра", () => {
    const tag = [...new TextEncoder().encode("Info"), 0, 0, 0, 1, 0, 0, 0, 10];
    const first = new Uint8Array([
      ...frame(4, [...Array.from({ length: 9 }, () => 0), ...tag]),
      ...Array.from({ length: 500 }, () => 0),
    ]);
    // 10 кадров × 576 / 24000 = 0,24 с; длина около 530 байт → ≈17 кбит/с
    const rate = mp3Bitrate(first)!;
    expect(rate).toBeGreaterThan(15_000);
    expect(rate).toBeLessThan(20_000);
  });

  it("не mp3 — undefined", () => {
    expect(mp3Bitrate(new Uint8Array([1, 2, 3, 4, 5, 6]))).toBeUndefined();
    expect(mp3Bitrate(new Uint8Array([0xff, 0xfd, 0x90, 0xc4]))).toBeUndefined();
  });
});

describe("бюджеты контента", () => {
  const ok = catalog([{ id: "a", courseId: "c" }]);
  const small = [{ path: "content/catalog.json", body: "{}", mimeType: "application/json" }, pack("a", "{}")];

  it("всё в пределах — нарушений нет, сводка с запасом", () => {
    const report = checkBudgets(small, ok, limits);
    expect(report.violations).toEqual([]);
    expect(report.summary).toContain("из 100");
  });

  it("раздутый пакет называется по пути", () => {
    const report = checkBudgets([...small, pack("big", noise(2000))], ok, limits);
    expect(report.violations[0]).toMatch(/^пакет content\/packages\/big\.json: \d+ байт gzip больше предела 100$/);
  });

  it("каталог выше предела", () => {
    const files = [{ path: "content/catalog.json", body: noise(2000), mimeType: "application/json" }];
    expect(checkBudgets(files, ok, limits).violations[0]).toMatch(/^каталог: \d+ байт gzip больше предела 100$/);
  });

  it("курс — сумма gzip его пакетов", () => {
    const files = [pack("a", noise(120)), pack("b", noise(120))];
    const lessons = catalog([
      { id: "a", courseId: "c" },
      { id: "b", courseId: "c" },
    ]);
    const wide = { ...limits, packageGzip: 1000, courseGzip: 150 };
    expect(checkBudgets(files, lessons, wide).violations).toEqual([expect.stringMatching(/^курс c: \d+ байт gzip/)]);
    const split = catalog([
      { id: "a", courseId: "c" },
      { id: "b", courseId: "d" },
    ]);
    expect(checkBudgets(files, split, wide).violations).toEqual([]);
  });

  it("mp3: высокий битрейт, большой файл и нечитаемый заголовок", () => {
    const mp3 = (name: string, body: Uint8Array) => ({
      path: `content/media/${name}.mp3`,
      body,
      mimeType: "audio/mpeg",
    });
    const files = [
      mp3("fast", frame(8)),
      mp3("big", new Uint8Array([...frame(4), ...Array.from({ length: 600 }, () => 0)])),
      mp3("bad", new Uint8Array(8)),
    ];
    expect(checkBudgets(files, ok, limits).violations).toEqual([
      "аудио content/media/fast.mp3: 64000 бит/с больше предела 32000",
      "аудио content/media/big.mp3: 604 байт больше предела 500",
      "аудио content/media/bad.mp3: заголовок mp3 (Layer III) не разобран",
    ]);
  });
});
