import { describe, expect, it } from "vitest";
import { slowFiles } from "./setup/slow-files-reporter";

describe("отчёт о медленных тестовых файлах", () => {
  it("файл дольше 10 с отмечается, 9 с — нет, самый долгий первым", () => {
    const slow = slowFiles([
      { file: "a.test.ts", project: "unit", ms: 9_000 },
      { file: "b.test.ts", project: "unit", ms: 11_000 },
      { file: "c.test.ts", project: "unit", ms: 15_000 },
    ]);
    expect(slow.map((time) => time.file)).toEqual(["c.test.ts", "b.test.ts"]);
  });

  it("у heavy порог 60 с", () => {
    expect(slowFiles([{ file: "scale.test.ts", project: "heavy", ms: 30_000 }])).toEqual([]);
    expect(slowFiles([{ file: "scale.test.ts", project: "heavy", ms: 61_000 }])).toHaveLength(1);
  });
});
