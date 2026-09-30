import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import Dexie from "dexie";
import { LexiDatabase } from "../src/storage/db";
import { isStorageError, reopenDatabase, storageHealer } from "../src/storage/recovery";

describe("восстановление после сбоя хранилища", () => {
  it("ошибки хранилища распознаются по имени, в том числе вложенные в ошибку Dexie; остальные — нет", () => {
    expect(
      isStorageError(
        new DOMException("Attempt to get a record from database without an in-progress transaction", "UnknownError"),
      ),
    ).toBe(true);
    expect(isStorageError(new DOMException("", "InvalidStateError"))).toBe(true);
    expect(isStorageError(new DOMException("", "TransactionInactiveError"))).toBe(true);
    expect(isStorageError(new Dexie.DatabaseClosedError("closed"))).toBe(true);
    expect(
      isStorageError(
        Object.assign(new Dexie.DexieError("PromiseFailed", "wrapped"), {
          inner: new DOMException("", "UnknownError"),
        }),
      ),
    ).toBe(true);
    expect(isStorageError(Object.assign(new Error("outer"), { inner: { inner: { name: "AbortError" } } }))).toBe(true);
    expect(isStorageError(new TypeError("x is not a function"))).toBe(false);
    expect(isStorageError(new DOMException("missing", "NotFoundError"))).toBe(false);
    expect(isStorageError(null)).toBe(false);
    expect(isStorageError("UnknownError")).toBe(false);
  });
  it("база переоткрывается тем же экземпляром и снова отвечает на запросы", async () => {
    const database = new LexiDatabase("lexi-recovery");
    await database.delete();
    await database.open();
    await database.meta.put({ key: "probe", value: "1" });
    database.close();
    expect(database.isOpen()).toBe(false);
    await reopenDatabase(database);
    expect(database.isOpen()).toBe(true);
    expect((await database.meta.get("probe"))?.value).toBe("1");
    await reopenDatabase(database); // повтор на открытой базе безвреден
    expect((await database.meta.get("probe"))?.value).toBe("1");
    database.close();
  });

  it("лечение вне дерева React повторяет переоткрытие не больше трёх раз за минуту", async () => {
    let at = 0,
      reopened = 0;
    const attempts: number[] = [];
    const heal = storageHealer({
      reopen: async () => {
        reopened++;
      },
      onRecovered: (attempt) => attempts.push(attempt),
      now: () => at,
    });
    const sleepy = new DOMException(
      "Attempt to delete range from database without an in-progress transaction",
      "UnknownError",
    );
    expect(await heal(new TypeError("x is not a function"))).toBe(false);
    expect(await heal(sleepy)).toBe(true);
    expect(await heal(sleepy)).toBe(true);
    expect(await heal(sleepy)).toBe(true);
    expect(await heal(sleepy)).toBe(false); // попытки исчерпаны: отказ признаётся невылеченным
    expect(attempts).toEqual([1, 2, 3]);
    at += 60000; // окно прошло — счёт начинается заново
    expect(await heal(sleepy)).toBe(true);
    expect(reopened).toBe(4);
  });
  it("не считает лечением неудачное переоткрытие", async () => {
    const heal = storageHealer({ reopen: () => Promise.reject(new Error("нет места")) });
    expect(await heal(new DOMException("", "UnknownError"))).toBe(false);
  });
});
