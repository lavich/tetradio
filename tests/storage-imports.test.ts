import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("слои хранения", () => {
  it("курсы и ожидающие уроки не импортируют синхронизацию: иначе цикл storage → sync → storage", () => {
    for (const file of ["src/storage/courses.ts", "src/storage/pending.ts"])
      expect(readFileSync(file, "utf8")).not.toMatch(/from "\.\.\/sync\/(?!types")/);
  });
});
