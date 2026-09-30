import { useState } from "react";

export type Describe = (error: unknown) => string;

/**
 * Асинхронное действие экрана: пока идёт — `busy`, при запуске прошлая жалоба снимается, упавшее попадает
 * в `problem`, `busy` снимается в любом исходе. `describe` задаёт формулировку вместо сообщения исключения.
 * `setProblem` открыт для жалоб без исключения — например, когда очередь на сегодня пуста.
 */
export function useAction(fallback: string) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const run = async (
    action: () => Promise<unknown>,
    describe: Describe = (error) => (error instanceof Error ? error.message : fallback),
  ) => {
    setBusy(true);
    setProblem("");
    try {
      await action();
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setBusy(false);
    }
  };
  return { busy, problem, setProblem, run };
}
