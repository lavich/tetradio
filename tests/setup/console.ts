import { afterEach, beforeEach, vi } from "vitest";

type Method = "warn" | "error";
const METHODS: Method[] = ["warn", "error"];
let calls: { method: Method; args: unknown[] }[] = [];
let spies: { mockRestore(): void }[] = [];

/**
 * Предупреждение или ошибка в консоли во время теста — провал теста: шум в логе CI прячет настоящие сбои.
 * Тест, который сбой устраивает намеренно, забирает ожидаемые сообщения через `takeConsole`.
 */
beforeEach(() => {
  calls = [];
  spies = METHODS.map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      calls.push({ method, args });
    }),
  );
});
afterEach(() => {
  const left = calls;
  calls = [];
  // Тест мог сам подменить и восстановить консоль: восстанавливаются свои подмены, а не то, что лежит в console сейчас.
  for (const spy of spies) spy.mockRestore();
  if (left.length)
    throw new Error(
      `Неожиданный вывод в консоль:\n${left.map(({ method, args }) => `console.${method}: ${args.map(String).join(" ")}`).join("\n")}`,
    );
});

/** Ожидаемые сообщения консоли текущего теста; забранные не считаются неожиданными. */
export function takeConsole(method: Method): unknown[][] {
  const taken = calls.filter((call) => call.method === method).map((call) => call.args);
  calls = calls.filter((call) => call.method !== method);
  return taken;
}
