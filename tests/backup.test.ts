import "fake-indexeddb/auto";
import "./helpers/self";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { exportFull, exportWordsTsv, inspectBackup, restoreBackup } from "../src/features/backup/backup";
import { lessonItems, dexieSource } from "../src/storage/queries";
import { makeSession } from "../src/domain/learning";
import { submitAnswer } from "../src/storage/ops";
import { applyPackage } from "../src/content/client";
import { phraseRevisionOf } from "../content/build";
import { unitKey, wordKeyOf, wordRef } from "./helpers/cards";
import { content, installLessons, itemCountOf, packageOf, wordsOf } from "./helpers/content";
import { buildMixed, installMixed, MIXED_LESSON, MIXED_PHRASES, mixedPackage } from "./helpers/mixed";

const NAME = "tetradio-backup";
/** Тестовая база называется иначе, а копия проверяется по имени базы приложения. */
const asLexi = (parsed: { data: { databaseName: string } }) =>
  new Blob([JSON.stringify({ ...parsed, data: { ...parsed.data, databaseName: "tetradio" } })], {
    type: "application/json",
  });

describe("полная копия", () => {
  let db: AppDatabase;
  beforeEach(async () => {
    await Dexie.delete(NAME);
    db = new AppDatabase(NAME);
    await db.open();
  });
  afterEach(async () => {
    db.close();
    await Dexie.delete(NAME);
  });
  it("новая копия содержит связи, медиа и метаданные пакетов, но не каталог; восстановление воспроизводит данные", async () => {
    await installLessons(db, ["mech-2"]);
    const blob = await exportFull(db);
    const parsed = JSON.parse(await blob.text());
    const names = parsed.data.tables.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["lessonItems", "cardStates", "phrases", "packages", "media", "words"]),
    );
    expect(parsed.data.data.find((t: { tableName: string }) => t.tableName === "catalog")?.rows ?? []).toEqual([]);
    const copy = asLexi(parsed);
    const check = await inspectBackup(copy);
    expect(check.ok && check.report.legacy).toBe(false);
    const fresh = new AppDatabase("tetradio-restore-target");
    await fresh.delete();
    await fresh.open();
    await restoreBackup(copy, fresh);
    expect(await fresh.words.count()).toBe(wordsOf("mech-2").length);
    expect(await fresh.lessonItems.count()).toBe(itemCountOf("mech-2"));
    expect((await fresh.packages.get("mech-2"))!.version).toBe(packageOf("mech-2").version);
    expect(await fresh.catalog.count()).toBe(0);
    fresh.close();
    await fresh.delete();
  });
  it("разметка слов примера входит в полную копию и восстанавливается", async () => {
    await installLessons(db, ["mech-2"]);
    const friend = (await db.words.get("w034"))!;
    const glosses = [{ start: 2, length: 5, russian: "друг", wordId: "w034" }];
    await db.words.put({ ...friend, examples: [{ ...friend.examples[0], glosses }] });
    const copy = asLexi(JSON.parse(await (await exportFull(db)).text()));
    const fresh = new AppDatabase("tetradio-restore-glosses");
    await fresh.delete();
    await fresh.open();
    await restoreBackup(copy, fresh);
    expect((await fresh.words.get("w034"))!.examples[0].glosses).toEqual(glosses);
    expect((await fresh.words.get("w024"))!.examples.every((example) => example.glosses === undefined)).toBe(true);
    fresh.close();
    await fresh.delete();
  });
  it("повреждённая копия, копия новее приложения и копия с битыми связями отклоняются без изменения данных", async () => {
    await installLessons(db, ["mech-1"]);
    const before = await db.words.count();
    expect(await inspectBackup(new Blob(["{не json"]))).toMatchObject({ ok: false });
    expect(
      await inspectBackup(
        new Blob([
          JSON.stringify({
            formatName: "dexie",
            formatVersion: 1,
            data: { databaseName: "tetradio", databaseVersion: 10, tables: [], data: [] },
          }),
        ]),
      ),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/более новой версией/) });
    expect(
      await inspectBackup(
        new Blob([
          JSON.stringify({
            formatName: "dexie",
            formatVersion: 1,
            data: { databaseName: "tetradio", databaseVersion: 8, tables: [{ name: "words", rowCount: 0 }], data: [] },
          }),
        ]),
      ),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/обязательных таблиц/) });
    const good = JSON.parse(await (await exportFull(db)).text());
    const links = good.data.data.find((t: { tableName: string }) => t.tableName === "lessonItems");
    links.rows.push({
      lessonId: "mech-1",
      unitKey: wordKeyOf("нет-такого"),
      ref: wordRef("нет-такого"),
      position: 99,
    });
    await expect(restoreBackup(asLexi(good), db)).rejects.toThrow(/несуществующую запись/);
    expect(await db.words.count()).toBe(before);
    expect(await db.lessonItems.count()).toBe(itemCountOf("mech-1"));
  });
  it("смешанный профиль с активной сессией переносится целиком, снимки заданий совпадают", async () => {
    await installMixed(db);
    const now = new Date("2026-09-16T09:00:00Z");
    const session = await makeSession({
      source: dexieSource(db),
      now,
      random: () => 0.4,
      mode: "practice",
      refs: [
        { kind: "phrase", id: "p-grafo" },
        { kind: "phrase", id: "p-xora" },
        { kind: "word", id: "w070" },
      ],
    });
    await db.sessions.add(session);
    const grafo = session.items.find((item) => item.ref.id === "p-grafo")!,
      xora = session.items.find((item) => item.ref.id === "p-xora")!;
    await submitAnswer({
      session,
      item: grafo,
      correct: false,
      answer: "γραφω",
      responseTimeMs: 800,
      activeTimeMs: 800,
      timezone: "Asia/Nicosia",
      now,
      database: db,
    });
    await submitAnswer({
      session,
      item: xora,
      correct: true,
      answer: "Η Κύπρος είναι μια μικρή χώρα.",
      responseTimeMs: 800,
      activeTimeMs: 1600,
      timezone: "Asia/Nicosia",
      now,
      database: db,
    });
    const blob = await exportFull(db);
    const parsed = JSON.parse(await blob.text());
    const names = parsed.data.tables.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["phrases", "lessonItems", "cardStates", "events", "sessions"]));
    const fresh = new AppDatabase("tetradio-cards-restore");
    await fresh.delete();
    await fresh.open();
    await restoreBackup(asLexi(parsed), fresh);
    for (const name of [
      "words",
      "phrases",
      "lessonItems",
      "cardStates",
      "events",
      "sessions",
      "packages",
      "media",
    ] as const)
      expect(await fresh.table(name).toArray(), name).toEqual(await db.table(name).toArray());
    const events = await fresh.events.where("sessionId").equals(session.id).toArray();
    expect(events.find((e) => e.ref.id === "p-grafo")!.snapshot).toEqual({
      text: "Γράφω ένα γράμμα.",
      translation: "Я пишу письмо.",
    });
    expect(events.find((e) => e.ref.id === "p-xora")!.snapshot).toEqual({
      text: "Η Κύπρος είναι μια μικρή χώρα.",
      translation: "Кипр — маленькая страна.",
    });
    expect((await fresh.sessions.get(session.id))!.status).toBe("active");
    fresh.close();
    await fresh.delete();
  });
  it("копия с фразами без слов допустима, а связь с отсутствующей карточкой отклоняется до замены данных", async () => {
    const noWords = buildMixed({
      phrases: { "p-grafo": MIXED_PHRASES["p-grafo"], "p-xora": MIXED_PHRASES["p-xora"] },
      lesson: {
        title: "Без слов",
        language: "el",
        items: [
          { kind: "phrase", id: "p-grafo" },
          { kind: "phrase", id: "p-xora" },
        ],
      },
    });
    await installMixed(db, [MIXED_LESSON], noWords);
    expect(await db.words.count()).toBe(0);
    const parsed = JSON.parse(await (await exportFull(db)).text());
    const fresh = new AppDatabase("tetradio-cards-nowords");
    await fresh.delete();
    await fresh.open();
    await restoreBackup(asLexi(parsed), fresh);
    expect(await fresh.phrases.count()).toBe(2);
    expect((await lessonItems(MIXED_LESSON, fresh)).map((link) => link.ref.kind)).toEqual(["phrase", "phrase"]);
    // Битая ссылка на фразу: текущие данные не меняются.
    const broken = JSON.parse(JSON.stringify(parsed));
    broken.data.data
      .find((t: { tableName: string }) => t.tableName === "lessonItems")
      .rows.push({
        lessonId: MIXED_LESSON,
        unitKey: unitKey({ kind: "phrase", id: "нет" }),
        ref: { kind: "phrase", id: "нет" },
        position: 9,
      });
    const before = await fresh.lessonItems.count();
    await expect(restoreBackup(asLexi(broken), fresh)).rejects.toThrow(/несуществующую запись/);
    expect(await fresh.lessonItems.count()).toBe(before);
    fresh.close();
    await fresh.delete();
  });
  it("TSV по-прежнему содержит только слова", async () => {
    await installMixed(db);
    const tsv = await (await exportWordsTsv(db)).text();
    const lines = tsv.split("\n");
    expect(lines).toHaveLength(1 + (await db.words.count()));
    expect(tsv).not.toContain("Γράφω ένα γράμμα.");
  });
  it("обновление пакета, исправившее примечание фразы, меняет ревизию, но не ID и не прогресс", async () => {
    await installMixed(db);
    const pack = mixedPackage();
    const xora = pack.phrases.find((p) => p.id === "p-xora")!;
    const { revision: _r, ...fields } = xora;
    const fixed = { ...fields, note: "Прилагательное согласуется с существительным." };
    const next = {
      ...pack,
      version: `${pack.version}-note`,
      phrases: pack.phrases.map((p) => (p.id === "p-xora" ? { ...fixed, revision: phraseRevisionOf(fixed) } : p)),
    };
    await applyPackage(next, db);
    const stored = (await db.phrases.get("p-xora"))!;
    expect(stored.note).toBe("Прилагательное согласуется с существительным.");
    expect(stored.revision).not.toBe(xora.revision);
    expect(content.packages.length).toBeGreaterThan(0);
  });
});
