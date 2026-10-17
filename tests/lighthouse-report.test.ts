import { describe, expect, it } from "vitest";
import { inDistOf } from "../scripts/bundle-metrics";
import { lazyScripts, median, verdict, type Run } from "../scripts/lighthouse-report";

const runs = (lcps: number[], tbt = 0, weight = 400_000): Run[] => lcps.map((lcp) => ({ lcp, tbt, weight }));

describe("бюджет Lighthouse", () => {
  it("LCP между 3 и 4 с — предупреждение без ошибки", () => {
    const result = verdict(runs([3400, 3500, 3600]), 0);
    expect(result.warnings).toEqual(["LCP 3500 мс больше 3000 мс"]);
    expect(result.errors).toEqual([]);
  });

  it("LCP выше 4 с — ошибка", () => {
    expect(verdict(runs([4100, 4200, 4300]), 0).errors).toEqual(["LCP 4200 мс больше 4000 мс"]);
  });

  it("один выброс среди трёх не решает: берётся медиана", () => {
    const result = verdict(runs([3500, 9000, 3400]), 0);
    expect(result.lcp).toBe(3500);
    expect(result.errors).toEqual([]);
  });

  it("LCP до 3 с — тихо", () => {
    const result = verdict(runs([2800, 2900, 3000]), 0);
    expect(result.warnings.concat(result.errors)).toEqual([]);
  });

  it("TBT, вес и ленивые чанки выше предела — ошибки", () => {
    const result = verdict(runs([2000, 2000, 2000], 250, 470_000), 40_000);
    expect(result.errors).toHaveLength(3);
  });

  it("медиана чётного числа прогонов — среднее двух средних", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("ленивые чанки первого экрана", () => {
  const html = `<script type="module" src="/assets/app.js"></script><link rel="modulepreload" href="/assets/react.js">`;
  const origin = "http://localhost:4188";
  it("считает только скрипты вне стартового графа", () => {
    const requests = [
      { url: `${origin}/assets/app.js`, resourceType: "Script", transferSize: 100 },
      { url: `${origin}/assets/react.js`, resourceType: "Script", transferSize: 50 },
      { url: `${origin}/assets/sync.js`, resourceType: "Script", transferSize: 20 },
      { url: `${origin}/content/catalog.json`, resourceType: "Fetch", transferSize: 10 },
      { url: "https://other.example/x.js", resourceType: "Script", transferSize: 5 },
    ];
    expect(lazyScripts(requests, html, inDistOf("/"), origin)).toEqual([{ path: "assets/sync.js", bytes: 20 }]);
  });
});
