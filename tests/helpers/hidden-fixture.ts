import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const made: string[] = [];
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Копия фикстуры двух курсов; у перечисленных курсов дописано `hidden` (по умолчанию `true`). */
export function hiddenFixture(courseIds: string[], value = "true", from = "tests/fixtures/two-courses") {
  const root = mkdtempSync(join(tmpdir(), "hidden-"));
  made.push(root);
  cpSync(from, root, { recursive: true });
  for (const id of courseIds) {
    const file = join(root, "courses", `${id}.yaml`);
    writeFileSync(file, `${readFileSync(file, "utf8")}hidden: ${value}\n`);
  }
  return root;
}
