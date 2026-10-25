import "fake-indexeddb/auto";
import "./helpers/self";
import { beforeEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { refreshCatalog } from "../src/content/client";
import { exportFull, inspectBackup, restoreBackup } from "../src/features/backup/backup";
import { courses } from "../src/storage/courses";
import { AppDatabase } from "../src/storage/db";
import { installLessons, memoryFetcher } from "./helpers/content";
import { hiddenFixture } from "./helpers/hidden-fixture";

const ROOT = "tests/fixtures/two-courses";
const full = memoryFetcher(buildContent(ROOT));
const hidden = memoryFetcher(buildContent(hiddenFixture(["english", "talk", "travel"])));

type Dump = {
  data: {
    tables: { name: string; rowCount: number }[];
    data: { tableName: string; rows: Record<string, unknown>[] }[];
  };
};
const table = (dump: Dump, name: string) => dump.data.data.find((entry) => entry.tableName === name)!;
const setRows = (dump: Dump, name: string, rows: Record<string, unknown>[]) => {
  table(dump, name).rows = rows;
  dump.data.tables.find((entry) => entry.name === name)!.rowCount = rows.length;
};
const blob = (dump: Dump) => new Blob([JSON.stringify(dump)], { type: "application/json" });

let counter = 0;
async function open() {
  const database = new AppDatabase(`tetradio-hidden-backup-${++counter}`);
  await database.delete();
  await database.open();
  return database;
}
async function copyWithEnglish() {
  const source = await open();
  await installLessons(source, ["m01-1", "e01-1"], full);
  for (const id of ["m01-1", "e01-1"]) await source.lessons.update(id, { completed: true });
  await source.blockProgress.put({
    key: "e01-1/vocabulary",
    lessonId: "e01-1",
    blockId: "vocabulary",
    done: true,
    updatedAt: "2026-10-20T09:00:00Z",
  });
  return JSON.parse(await (await exportFull(source)).text()) as Dump;
}

let target: AppDatabase;
beforeEach(async () => {
  target = await open();
  await refreshCatalog(target, hidden);
});

describe("копия с прогрессом курса, которого нет в каталоге", () => {
  it("копия с пакетами скрытого курса восстанавливается и возвращает курс после снятия hidden", async () => {
    const dump = await copyWithEnglish();
    expect(await inspectBackup(blob(dump), target)).toMatchObject({ ok: true });
    await restoreBackup(blob(dump), target);
    expect((await target.lessons.get("e01-1"))?.completed).toBe(true);
    expect((await courses(target)).map((course) => course.id)).toEqual(["greek-a2"]);
    await refreshCatalog(target, full);
    expect((await courses(target)).map((course) => course.id)).toContain("english");
  });

  it("урок скрытого курса без пакета и блок без урока в копии не отклоняют копию", async () => {
    const dump = await copyWithEnglish();
    setRows(
      dump,
      "packages",
      table(dump, "packages").rows.filter((row) => row.lessonId !== "e01-1"),
    );
    setRows(dump, "blockProgress", [
      ...table(dump, "blockProgress").rows,
      { key: "e99-1/intro", lessonId: "e99-1", blockId: "intro", done: true, updatedAt: "2026-10-20T09:00:00Z" },
    ]);
    await restoreBackup(blob(dump), target);
    expect(await target.blockProgress.get("e99-1/intro")).toBeDefined();
  });

  it("строка курса без его уроков в копии блоки без урока не оправдывает", async () => {
    const dump = await copyWithEnglish();
    setRows(
      dump,
      "lessons",
      table(dump, "lessons").rows.filter((row) => row.courseId !== "english"),
    );
    setRows(
      dump,
      "packages",
      table(dump, "packages").rows.filter((row) => row.lessonId !== "e01-1"),
    );
    setRows(dump, "blockProgress", [
      { key: "m99-9/intro", lessonId: "m99-9", blockId: "intro", done: true, updatedAt: "2026-10-20T09:00:00Z" },
    ]);
    await expect(restoreBackup(blob(dump), target)).rejects.toThrow(/урок m99-9/);
  });

  it("урок видимого курса, которого нет в каталоге, по-прежнему отклоняется", async () => {
    const dump = await copyWithEnglish();
    const lessons = table(dump, "lessons").rows;
    const greek = lessons.find((row) => row.id === "m01-1")!;
    setRows(dump, "lessons", [...lessons, { ...greek, id: "m99-9" }]);
    await expect(restoreBackup(blob(dump), target)).rejects.toThrow(/m99-9.*каталоге/);
  });
});
