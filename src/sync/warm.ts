import type { SyncStatus } from "./coordinator";

interface StatusSource {
  subscribe(listener: () => void): () => void;
  getStatus(): Pick<SyncStatus, "phase">;
}
const SETTLED: SyncStatus["phase"][] = ["synced", "error", "conflict", "paused"];

/** Один раз после первого завершённого обмена, в простое: не в окне первого экрана, но до следующей публикации. */
export function afterFirstExchange(source: StatusSource, run: () => void, idle: (task: () => void) => void) {
  let done = false;
  const check = () => {
    if (done || !SETTLED.includes(source.getStatus().phase)) return;
    done = true;
    off();
    idle(run);
  };
  const off = source.subscribe(check);
}
