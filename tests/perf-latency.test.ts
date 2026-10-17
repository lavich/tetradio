import { describe, expect, it } from "vitest";
import { latencies, percentile, UNOBSERVED_MS } from "./perf/latency";

describe("задержка отклика", () => {
  it("записи одного нажатия сводятся к самой долгой", () => {
    const entries = [
      { id: 1, duration: 24 },
      { id: 1, duration: 80 },
      { id: 1, duration: 32 },
      { id: 2, duration: 40 },
    ];
    expect(latencies(entries, 2)).toEqual([80, 40]);
  });

  it("нажатия без записи (быстрее порога наблюдателя) считаются 8 мс", () => {
    expect(latencies([{ id: 1, duration: 50 }], 4)).toEqual([50, UNOBSERVED_MS, UNOBSERVED_MS, UNOBSERVED_MS]);
  });

  it("p98: на сотне нажатий — третье сверху; на пустом — 0", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 0.98)).toBe(98);
    expect(percentile([], 0.98)).toBe(0);
  });
});
