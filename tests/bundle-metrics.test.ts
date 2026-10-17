import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffTable } from "../scripts/bundle-diff";
import { measure, overLimits, startGraph, type BundleMetrics } from "../scripts/bundle-metrics";

const metrics: BundleMetrics = {
  initialRaw: 600,
  initialGzip: 200,
  initialBrotli: 180,
  cssRaw: 90,
  cssGzip: 19,
  precacheBytes: 1000,
  fontBytes: 250,
};

describe("метрики сборки", () => {
  it("предел превышен — сообщение называет метрику, значение и предел", () => {
    expect(overLimits(metrics, { initialGzip: 199, initialBrotli: 180 })).toEqual([
      "стартовый JS gzip 200 байт больше предела 199",
    ]);
  });

  it("стартовый граф: модуль, modulepreload и CSS без базы", () => {
    const html = `<script type="module" crossorigin src="/b/assets/a.js"></script>
      <link rel="modulepreload" crossorigin href="/b/assets/c.js">
      <link rel="stylesheet" crossorigin href="/b/assets/a.css">`;
    expect(startGraph(html, (href) => href.replace("/b/", ""))).toEqual({
      scripts: ["assets/a.js", "assets/c.js"],
      styles: ["assets/a.css"],
    });
  });

  it("измеряет сжатие, CSS, precache и шрифты по содержимому dist", () => {
    const dist = mkdtempSync(join(tmpdir(), "bundle-"));
    mkdirSync(join(dist, "app"));
    mkdirSync(join(dist, "assets"));
    writeFileSync(
      join(dist, "app/index.html"),
      `<script type="module" src="/assets/a.js"></script><link rel="stylesheet" href="/assets/a.css">`,
    );
    writeFileSync(join(dist, "assets/a.js"), "a".repeat(1000));
    writeFileSync(join(dist, "assets/a.css"), "b".repeat(500));
    writeFileSync(join(dist, "assets/f.woff2"), "c".repeat(300));
    writeFileSync(join(dist, "sw.js"), `[{url:"assets/a.js"},{url:"assets/f.woff2"}]`);
    const result = measure(dist, "/")!;
    expect(result).toMatchObject({ initialRaw: 1000, cssRaw: 500, precacheBytes: 1300, fontBytes: 300 });
    expect(result.initialGzip).toBeLessThan(100);
    expect(result.initialBrotli).toBeLessThan(100);
  });
});

describe("таблица PR против main", () => {
  it("рост и падение с долей", () => {
    const table = diffTable({ ...metrics, initialGzip: 210, cssGzip: 19 }, metrics);
    expect(table).toContain("| стартовый JS gzip | 200 | 210 | +10 (+5 %) |");
    expect(table).toContain("| CSS первого экрана gzip | 19 | 19 | 0 |");
    expect(diffTable({ ...metrics, fontBytes: 200 }, metrics)).toContain("-50 (-20 %)");
  });

  it("нет базы — запись об этом", () => {
    expect(diffTable(metrics)).toContain("Сравнения с `main` нет");
  });
});
