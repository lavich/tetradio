import { describe, expect, it } from "vitest";
import { databaseStore, emptyRow } from "../bot/store";
import { sqlite } from "./helpers/sqlite-d1";

describe("хранилище связей на D1", () => {
  it("строка находится по пользователю и по теме", async () => {
    const store = databaseStore(sqlite());
    await store.setThread(42, 7);
    await store.setAck(42, 1000);
    expect(await store.byUser(42)).toEqual({ ...emptyRow(42), thread: 7, ackAt: 1000 });
    expect((await store.byThread(7))?.userId).toBe(42);
    expect(await store.byUser(43)).toBeNull();
    expect(await store.byThread(8)).toBeNull();
  });

  it("каждая запись меняет только свои столбцы", async () => {
    const store = databaseStore(sqlite());
    await store.setThread(42, 7);
    await store.setFb(42, "abc", 5);
    await store.setBlocked(42, true);
    await store.setAck(42, 9);
    expect(await store.byUser(42)).toEqual({ ...emptyRow(42), thread: 7, fb: "abc", fbAt: 5, blocked: true, ackAt: 9 });
    await store.setBlocked(42, false);
    await store.setFb(42, null, null);
    expect(await store.byUser(42)).toEqual({ ...emptyRow(42), thread: 7, ackAt: 9 });
  });

  it("одна тема не принадлежит двум пользователям", async () => {
    const store = databaseStore(sqlite());
    await store.setThread(42, 7);
    await expect(store.setThread(43, 7)).rejects.toThrow();
  });

  it("слот формы — не чаще одного раза за интервал, в том числе для нового пользователя", async () => {
    const store = databaseStore(sqlite());
    expect(await store.claimForm(42, 100_000, 10_000)).toBe(true);
    expect(await store.claimForm(42, 105_000, 10_000)).toBe(false);
    expect(await store.claimForm(42, 110_000, 10_000)).toBe(true);
    expect((await store.byUser(42))?.formAt).toBe(110_000);
  });

  it("одновременные слоты формы — занят один", async () => {
    const store = databaseStore(sqlite());
    const results = await Promise.all([store.claimForm(42, 100_000, 10_000), store.claimForm(42, 100_001, 10_000)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("слот формы не трогает остальные столбцы", async () => {
    const store = databaseStore(sqlite());
    await store.setThread(42, 7);
    await store.setBlocked(42, true);
    await store.claimForm(42, 1, 10_000);
    expect(await store.byUser(42)).toEqual({ ...emptyRow(42), thread: 7, blocked: true, formAt: 1 });
  });

  it("забыть: обычный пользователь — строки нет", async () => {
    const store = databaseStore(sqlite());
    await store.setThread(42, 7);
    await store.setAck(42, 5);
    await store.forgetUser(42);
    expect(await store.byUser(42)).toBeNull();
  });

  it("забыть: у заблокированного остаётся только отметка", async () => {
    const store = databaseStore(sqlite());
    await store.setThread(42, 7);
    await store.setBlocked(42, true);
    await store.setFb(42, "abc", 1);
    await store.forgetUser(42);
    expect(await store.byUser(42)).toEqual({ ...emptyRow(42), blocked: true });
    expect(await store.blockedWithoutTopic()).toEqual([42]);
  });

  it("разблокировка без темы удаляет строку, с темой — снимает отметку, неизвестный — false", async () => {
    const store = databaseStore(sqlite());
    await store.setBlocked(42, true);
    await store.setThread(43, 9);
    await store.setBlocked(43, true);
    expect(await store.unblock(42)).toBe(true);
    expect(await store.byUser(42)).toBeNull();
    expect(await store.unblock(43)).toBe(true);
    expect(await store.byUser(43)).toMatchObject({ thread: 9, blocked: false });
    expect(await store.unblock(44)).toBe(false);
  });
});
