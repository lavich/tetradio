import { useRef, useState } from "react";
import type { BlockPatch } from "../../../storage/course";
import ui from "../../../shared/ui.module.css";

const SAVE_FAILED = "Не удалось сохранить. Проверьте место на устройстве и повторите.";

export function SaveProblem({ problem }: { problem: string }) {
  return problem ? (
    <p className={ui.error} role="alert">
      {problem}
    </p>
  ) : null;
}

/** Сохранение блока с жалобой на сбой: `true`, если записалось. */
export function useSave(save: (patch: BlockPatch) => Promise<unknown>) {
  const [problem, setProblem] = useState("");
  const latest = useRef(save);
  latest.current = save;
  const [store] = useState(() => (patch: BlockPatch) => {
    setProblem("");
    return latest.current(patch).then(
      () => true,
      () => {
        setProblem(SAVE_FAILED);
        return false;
      },
    );
  });
  return { store, problem };
}
