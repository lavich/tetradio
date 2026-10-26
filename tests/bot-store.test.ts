import { describe, expect, it } from "vitest";
import { databaseStore, emptyRow } from "../bot/store";
import { sqlite } from "./helpers/sqlite-d1";

describe("хранилище связей на D1", () => {
  it("строка находится по пользователю и по теме", async () => {
    const store = databaseStore(sqlite());
    await store.save({ ...emptyRow(42), thread: 7, ackAt: 1000 });
    expect(await store.byUser(42)).toEqual({ ...emptyRow(42), thread: 7, ackAt: 1000 });
    expect((await store.byThread(7))?.userId).toBe(42);
    expect(await store.byUser(43)).toBeNull();
    expect(await store.byThread(8)).toBeNull();
  });

  it("повторная запись обновляет строку целиком", async () => {
    const store = databaseStore(sqlite());
    await store.save({ ...emptyRow(42), fb: "abc", fbAt: 1 });
    await store.save({ ...emptyRow(42), thread: 9, blocked: true });
    expect(await store.byUser(42)).toEqual({ ...emptyRow(42), thread: 9, blocked: true });
    expect((await store.byThread(9))?.blocked).toBe(true);
  });

  it("одна тема не принадлежит двум пользователям", async () => {
    const store = databaseStore(sqlite());
    await store.save({ ...emptyRow(42), thread: 7 });
    await expect(store.save({ ...emptyRow(43), thread: 7 })).rejects.toThrow();
  });
});
